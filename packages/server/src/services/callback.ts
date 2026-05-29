import { createHmac, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { regenerateToken } from './identity.js';
import { cleanupStaleRuntimes, selectAvailableRuntime } from './runtime.js';
import { ensureAgentRoomState } from './room-context.js';

export interface CallbackEvent {
  type: 'spawn' | 'stop' | 'wake';
  agent_token?: string;
  agent_name?: string;
  session_id?: string;
  agent_model?: string;
  agent_provider?: unknown;
  prompt?: string;
  trigger_type?: string;
  room_id?: string;
  room_name?: string;
  message_id?: string;
  sender_name?: string;
  excerpt?: string;
}

// Keep RuntimeCallbackEvent as alias for backward compat
export type RuntimeCallbackEvent = CallbackEvent;

interface RuntimeRow {
  id: string;
  callback_url: string;
  callback_secret: string | null;
  status: string;
}

interface AgentRuntimeConfig {
  model?: string;
  provider?: unknown;
}

interface AgentCallbackFields {
  agent_token?: string;
  agent_name?: string;
  agent_model?: string;
  agent_provider?: unknown;
}

interface WakeSession {
  runtime: RuntimeRow;
  agent: { name: string; model: string | null; status: string };
  token: string;
  sessionId?: string;
}

type RoomWakeTriggerType = 'mention' | 'broadcast';

interface PendingRoomWake {
  db: Database.Database;
  agentId: string;
  roomId: string;
  roomName: string;
  messageId?: string;
  senderName: string;
  excerpt: string;
  triggeredById: string;
  triggerType: RoomWakeTriggerType;
  timer: ReturnType<typeof setTimeout>;
}

const pendingRoomWakes = new Map<string, PendingRoomWake>();

/** Log a wake event to the wake_events table */
function logWakeEvent(
  db: Database.Database,
  agentId: string,
  triggeredBy: string,
  triggerType: string,
  status: string = 'sent',
  roomId?: string,
  prompt?: string,
): void {
  db.prepare(`
    INSERT INTO wake_events (id, agent_id, triggered_by, trigger_type, status, room_id, prompt, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), agentId, triggeredBy, triggerType, status, roomId ?? null, prompt ?? null, new Date().toISOString());
}

function createWakeSession(
  db: Database.Database,
  agentId: string,
  runtimeId: string,
  roomId: string | undefined,
  prompt: string | undefined,
): WakeSession | null {
  const runtime = db.prepare(
    'SELECT id, callback_url, callback_secret, status FROM agent_runtimes WHERE id = ?',
  ).get(runtimeId) as RuntimeRow | undefined;
  if (!runtime || runtime.status !== 'online') return null;

  const agent = db.prepare('SELECT name, model, status FROM profiles WHERE id = ?').get(agentId) as { name: string; model: string | null; status: string } | undefined;
  if (!agent) return null;
  if (agent.status === 'active') return null;
  if (agent.status === 'spawning' && hasPendingRoomWake(db, agentId, roomId)) return null;

  const { token } = regenerateToken(db, agentId);
  const now = new Date().toISOString();
  const sessionId = latestClaudeSessionId(db, agentId);
  db.prepare("UPDATE agent_spawns SET status = 'stopped', last_active_at = ? WHERE agent_id = ? AND status = 'spawning'").run(now, agentId);
  db.prepare(`
    INSERT INTO agent_spawns (id, agent_id, runtime_id, session_id, session_source, status, spawned_at, last_active_at, prompt)
    VALUES (?, ?, ?, ?, ?, 'spawning', ?, ?, ?)
  `).run(randomUUID(), agentId, runtimeId, sessionId ?? null, sessionId ? 'claude-cli' : null, now, now, prompt ?? null);
  db.prepare("UPDATE profiles SET status = 'spawning', updated_at = ? WHERE id = ?").run(now, agentId);

  return { runtime, agent, token, sessionId };
}

function hasPendingRoomWake(db: Database.Database, agentId: string, roomId: string | undefined): boolean {
  if (!roomId) return false;
  const row = db.prepare(`
    SELECT id
    FROM agent_spawns
    WHERE agent_id = ? AND status = 'spawning' AND prompt LIKE ?
    ORDER BY spawned_at DESC
    LIMIT 1
  `).get(agentId, `You were woken in room "%(${roomId})%`) as { id: string } | undefined;
  return Boolean(row);
}

function roomWakeDebounceMs(): number {
  const raw = Number(process.env.FLOCK_ROOM_WAKE_DEBOUNCE_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return process.env.NODE_ENV === 'test' ? 5 : 200;
}

function pendingRoomWakeKey(agentId: string, roomId: string): string {
  return `${agentId}:${roomId}`;
}

function scheduleRoomWake(
  db: Database.Database,
  agentId: string,
  roomId: string,
  roomName: string,
  triggerType: RoomWakeTriggerType,
  senderName: string,
  excerpt: string,
  triggeredById: string,
  messageId?: string,
): void {
  const profile = db.prepare('SELECT status FROM profiles WHERE id = ?').get(agentId) as { status: string } | undefined;
  if (!profile || profile.status === 'active') return;
  if (profile.status === 'spawning' && hasPendingRoomWake(db, agentId, roomId)) return;

  const key = pendingRoomWakeKey(agentId, roomId);
  const existing = pendingRoomWakes.get(key);
  if (existing) {
    clearTimeout(existing.timer);
  }

  const pending: PendingRoomWake = {
    db,
    agentId,
    roomId,
    roomName,
    messageId,
    senderName,
    excerpt,
    triggeredById,
    triggerType,
    timer: setTimeout(() => {
      pendingRoomWakes.delete(key);
      dispatchPendingRoomWake(pending).catch((err) => {
        console.error(`[callback] Failed to dispatch coalesced wake for agent ${agentId}:`, err);
      });
    }, roomWakeDebounceMs()),
  };
  pendingRoomWakes.set(key, pending);
}

async function dispatchPendingRoomWake(pending: PendingRoomWake): Promise<void> {
  const runtime = selectRuntimeForWake(pending.db, pending.agentId);
  if (!runtime) return;

  const reason = pending.triggerType === 'mention'
    ? `${pending.senderName} mentioned you`
    : `${pending.senderName} sent a broadcast wake`;
  const prompt = roomWakePrompt(pending.db, pending.roomId, pending.roomName, pending.agentId, reason, pending.excerpt);
  const session = createWakeSession(pending.db, pending.agentId, runtime.id, pending.roomId, prompt);
  if (!session) return;

  const event: CallbackEvent = {
    type: 'wake',
    trigger_type: pending.triggerType,
    ...agentCallbackFields(pending.db, pending.agentId, session.agent, session.token),
    session_id: session.sessionId,
    prompt,
    room_id: pending.roomId,
    room_name: pending.roomName,
    message_id: pending.messageId,
    sender_name: pending.senderName,
    excerpt: pending.excerpt,
  };

  await sendCallbackWithRetry(runtime, pending.agentId, event);
  logWakeEvent(pending.db, pending.agentId, pending.triggeredById, pending.triggerType, 'sent', pending.roomId, prompt);
}

export function clearPendingRoomWakesForTests(): void {
  for (const pending of pendingRoomWakes.values()) {
    clearTimeout(pending.timer);
  }
  pendingRoomWakes.clear();
}

function latestClaudeSessionId(db: Database.Database, agentId: string): string | undefined {
  const row = db.prepare(`
    SELECT session_id
    FROM agent_spawns
    WHERE agent_id = ? AND session_id IS NOT NULL AND session_source = 'claude-cli'
    ORDER BY spawned_at DESC
    LIMIT 1
  `).get(agentId) as { session_id: string } | undefined;
  return row?.session_id;
}

function selectRuntimeForWake(db: Database.Database, agentId: string): RuntimeRow | null {
  cleanupStaleRuntimes(db);

  const spawn = db.prepare(
    "SELECT runtime_id FROM agent_spawns WHERE agent_id = ? ORDER BY spawned_at DESC LIMIT 1",
  ).get(agentId) as { runtime_id: string | null } | undefined;

  if (spawn?.runtime_id) {
    const runtime = db.prepare(
      'SELECT id, callback_url, callback_secret, status FROM agent_runtimes WHERE id = ?',
    ).get(spawn.runtime_id) as RuntimeRow | undefined;
    if (runtime?.status === 'online') return runtime;
  }

  const fallbackRuntimeId = selectAvailableRuntime(db);
  if (!fallbackRuntimeId) return null;

  return db.prepare(
    'SELECT id, callback_url, callback_secret, status FROM agent_runtimes WHERE id = ?',
  ).get(fallbackRuntimeId) as RuntimeRow | undefined ?? null;
}

function agentCallbackFields(
  db: Database.Database,
  agentId: string,
  agent?: { name: string; model: string | null },
  token?: string,
): AgentCallbackFields {
  const profile = agent ?? db.prepare('SELECT name, model FROM profiles WHERE id = ?').get(agentId) as { name: string; model: string | null } | undefined;
  const config = getAgentRuntimeConfig(db, agentId);
  return {
    agent_token: token,
    agent_name: profile?.name,
    agent_model: config.model ?? profile?.model ?? undefined,
    agent_provider: config.provider,
  };
}

function recentRoomMessages(db: Database.Database, roomId: string, limit = 10): string {
  const rows = db.prepare(`
    SELECT m.content, p.name AS sender_name, m.created_at
    FROM messages m
    LEFT JOIN profiles p ON p.id = m.from_agent
    WHERE m.room_id = ?
    ORDER BY m.created_order DESC
    LIMIT ?
  `).all(roomId, limit) as Array<{ content: string; sender_name: string; created_at: string }>;

  if (rows.length === 0) return '';

  const lines = rows.reverse().map(r =>
    `[${r.created_at}] ${r.sender_name}: ${r.content.slice(0, 200)}${r.content.length > 200 ? '...' : ''}`
  );
  return lines.join('\n');
}

function roomWakePrompt(
  db: Database.Database,
  roomId: string,
  roomName: string,
  agentId: string,
  reason: string,
  fallbackExcerpt?: string,
): string {
  const state = ensureAgentRoomState(db, agentId, roomId);
  const latest = latestRoomSequence(db, roomId);
  const rulesVersion = roomRulesVersion(db, roomId);
  const excerpt = fallbackExcerpt ? ` Wake excerpt: ${fallbackExcerpt}` : '';
  const recentMessages = recentRoomMessages(db, roomId);

  const parts = [
    `You were woken in room "${roomName}" (${roomId}) because ${reason}.`,
  ];

  if (recentMessages) {
    parts.push(`Recent messages in this room:\n${recentMessages}`);
  }

  parts.push(
    `Room context protocol: before replying, call flock_room_sync ONLY if there are messages beyond sequence ${latest} that are not shown above. Your last synced sequence is ${state.last_seen_sequence}.${excerpt}`,
    `Room rules version: ${rulesVersion}; you last synced rules version ${state.rules_version_seen}. flock_room_sync returns the full rules only when this version changed.`,
    'After checking, respond in this room only when a response is useful. Do not post in other rooms.',
  );

  return parts.join('\n\n');
}

function latestRoomSequence(db: Database.Database, roomId: string): number {
  const row = db.prepare('SELECT COALESCE(MAX(sequence), 0) AS latest FROM messages WHERE room_id = ?').get(roomId) as { latest: number };
  return row.latest;
}

function roomRulesVersion(db: Database.Database, roomId: string): number {
  const row = db.prepare('SELECT COALESCE(rules_version, 0) AS version FROM rooms WHERE id = ?').get(roomId) as { version: number } | undefined;
  return Number(row?.version ?? 0);
}

/** Compute HMAC-SHA256 signature for a callback payload */
function signPayload(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** Send a callback to a runtime with HMAC signing and retry */
async function sendCallbackWithRetry(
  runtime: RuntimeRow,
  agentId: string,
  event: CallbackEvent | RuntimeCallbackEvent,
  maxRetries = 3,
): Promise<boolean> {
  if (!runtime.callback_secret) return false;

  const baseUrl = runtime.callback_url.replace(/\/+$/, '');
  const url = `${baseUrl}/agents/${agentId}/callback`;
  const body = JSON.stringify(event);
  const signature = `sha256=${signPayload(runtime.callback_secret, body)}`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Flock-Signature': signature,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) return true;
      if (res.status < 500) return false; // Client error, don't retry
    } catch {
      // Network error, retry
    }

    // Exponential backoff: 1s, 4s, 16s
    if (attempt < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(4, attempt)));
    }
  }

  return false;
}

/**
 * Wake dormant agents that were @mentioned in a message.
 * Looks up each mentioned agent's last spawn (any status), finds the runtime, sends wake callback.
 */
export function wakeMentionedAgents(
  db: Database.Database,
  mentionedAgentIds: string[],
  roomId: string,
  messageId: string,
  senderName: string,
  excerpt: string,
  triggeredById = senderName,
): void {
  if (mentionedAgentIds.length === 0) return;

  // Get room name
  const room = db.prepare('SELECT name FROM rooms WHERE id = ?').get(roomId) as { name: string } | undefined;
  const roomName = room?.name ?? roomId;

  for (const agentId of mentionedAgentIds) {
    scheduleRoomWake(db, agentId, roomId, roomName, 'mention', senderName, excerpt, triggeredById, messageId);
  }
}

/**
 * Wake all dormant agents in a room (broadcast wake).
 * Used when a human sends a message — all dormant agents in the room get notified.
 * Reuses the agent's last online runtime, or falls back to any available runtime.
 */
export function wakeRoomAgents(
  db: Database.Database,
  roomId: string,
  senderId: string,
  senderName: string,
  excerpt: string,
): void {
  const room = db.prepare('SELECT name FROM rooms WHERE id = ?').get(roomId) as { name: string } | undefined;
  const roomName = room?.name ?? roomId;

  // Find dormant room members that should be woken.
  const dormantAgents = db.prepare(`
    SELECT rm.agent_id
    FROM room_members rm
    JOIN profiles p ON p.id = rm.agent_id
    WHERE rm.room_id = ? AND p.status = 'dormant' AND rm.agent_id != ?
  `).all(roomId, senderId) as { agent_id: string }[];

  for (const { agent_id } of dormantAgents) {
    scheduleRoomWake(db, agent_id, roomId, roomName, 'broadcast', senderName, excerpt, senderId);
  }
}

/**
 * Wake a dormant agent when it receives a direct message.
 * Direct messages do not belong to a room, so the runtime prompt carries only sender/context.
 */
export function wakeDirectMessageAgent(
  db: Database.Database,
  agentId: string,
  senderName: string,
  excerpt: string,
): void {
  const profile = db.prepare('SELECT status FROM profiles WHERE id = ?').get(agentId) as { status: string } | undefined;
  if (!profile || profile.status !== 'dormant') return;

  const spawn = db.prepare(
    "SELECT runtime_id FROM agent_spawns WHERE agent_id = ? ORDER BY spawned_at DESC LIMIT 1",
  ).get(agentId) as { runtime_id: string } | undefined;
  if (!spawn?.runtime_id) return;

  const runtime = db.prepare(
    'SELECT id, callback_url, callback_secret, status FROM agent_runtimes WHERE id = ?',
  ).get(spawn.runtime_id) as RuntimeRow | undefined;
  if (!runtime || runtime.status !== 'online') return;

  const prompt = `${senderName} sent you a direct message:\n\n"${excerpt}"\n\nUse the Flock direct-message tools to read the conversation and reply directly if useful.`;
  const session = createWakeSession(db, agentId, runtime.id, undefined, prompt);
  if (!session) return;

  const event: CallbackEvent = {
    type: 'wake',
    trigger_type: 'direct_message',
    ...agentCallbackFields(db, agentId, session.agent, session.token),
    session_id: session.sessionId,
    prompt,
    sender_name: senderName,
    excerpt,
  };

  sendCallbackWithRetry(runtime, agentId, event).catch((err) => {
    console.error(`[callback] Failed to wake agent ${agentId} for direct message via runtime ${runtime.id}:`, err);
  });

  logWakeEvent(db, agentId, senderName, 'direct_message', 'sent', undefined, prompt);
}

/**
 * Notify a runtime to spawn an agent.
 * Called when POST /agents/:id/spawn is invoked.
 */
export function notifyRuntimeSpawn(
  db: Database.Database,
  runtimeId: string,
  agentId: string,
  prompt?: string,
  token?: string,
  roomId?: string,
  roomName?: string,
): void {
  const runtime = db.prepare(
    'SELECT id, callback_url, callback_secret, status FROM agent_runtimes WHERE id = ?',
  ).get(runtimeId) as RuntimeRow | undefined;

  if (!runtime || runtime.status !== 'online') {
    console.warn(`[callback] Runtime ${runtimeId} not found or offline, cannot spawn agent ${agentId}`);
    return;
  }

  const event: RuntimeCallbackEvent = {
    type: 'spawn',
    ...agentCallbackFields(db, agentId, undefined, token),
    session_id: latestClaudeSessionId(db, agentId),
    prompt: prompt ?? undefined,
    room_id: roomId,
    room_name: roomName,
  };

  sendCallbackWithRetry(runtime, agentId, event).catch((err) => {
    console.error(`[callback] Failed to notify runtime ${runtimeId} to spawn agent ${agentId}:`, err);
  });
}

function getAgentRuntimeConfig(db: Database.Database, agentId: string): AgentRuntimeConfig {
  const rows = db.prepare(`
    SELECT config_type, config_value
    FROM agent_configs
    WHERE agent_id = ? AND config_type IN ('model', 'provider')
  `).all(agentId) as Array<{ config_type: string; config_value: string }>;

  const config: AgentRuntimeConfig = {};
  for (const row of rows) {
    const value = parseConfigValue(row.config_value);
    if (row.config_type === 'model' && typeof value === 'string' && value.trim()) {
      config.model = value.trim();
    }
    if (row.config_type === 'provider' && value !== null && value !== undefined && value !== '') {
      config.provider = value;
    }
  }
  return config;
}

function parseConfigValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Notify an assigned agent about a new task (wake if dormant).
 * Called when a task is created or updated with an assigned_to field.
 */
export function notifyTaskAssignment(
  db: Database.Database,
  agentId: string,
  taskId: string,
  taskTitle: string,
  roomId: string,
): void {
  // Find last spawn for this agent (any status)
  const spawn = db.prepare(
    "SELECT runtime_id FROM agent_spawns WHERE agent_id = ? ORDER BY spawned_at DESC LIMIT 1",
  ).get(agentId) as { runtime_id: string } | undefined;

  if (!spawn?.runtime_id) return;

  const runtime = db.prepare(
    'SELECT id, callback_url, callback_secret, status FROM agent_runtimes WHERE id = ?',
  ).get(spawn.runtime_id) as RuntimeRow | undefined;

  if (!runtime || runtime.status !== 'online') return;

  const room = db.prepare('SELECT name FROM rooms WHERE id = ?').get(roomId) as { name: string } | undefined;
  const roomName = room?.name ?? roomId;
  const prompt = [
    `You were assigned task "${taskTitle}" (${taskId}) in room "${roomName}" (${roomId}).`,
    `Before replying or doing work, call flock_room_sync for this room and inspect unread messages. Last synced sequence: ${ensureAgentRoomState(db, agentId, roomId).last_seen_sequence}. Latest sequence: ${latestRoomSequence(db, roomId)}. Room rules version: ${roomRulesVersion(db, roomId)}.`,
    'Use the Flock task tools to inspect the task, update its status, and post progress in the room if appropriate. If flock_post says the room has unread messages, call flock_room_sync again before posting.',
  ].join('\n\n');
  const session = createWakeSession(db, agentId, runtime.id, roomId, prompt);
  if (!session) return;

  const event: RuntimeCallbackEvent = {
    type: 'wake',
    trigger_type: 'task_assignment',
    ...agentCallbackFields(db, agentId, session.agent, session.token),
    session_id: session.sessionId,
    prompt,
    room_id: roomId,
    room_name: roomName,
  };

  sendCallbackWithRetry(runtime, agentId, event).catch((err) => {
    console.error(`[callback] Failed to notify agent ${agentId} about task assignment:`, err);
  });

  logWakeEvent(db, agentId, 'system', 'task_assignment', 'sent', roomId, prompt);
}

/**
 * Notify a runtime to stop an agent.
 * Called when POST /agents/:id/stop is invoked.
 */
export function notifyRuntimeStop(
  db: Database.Database,
  runtimeId: string,
  agentId: string,
): void {
  const runtime = db.prepare(
    'SELECT id, callback_url, callback_secret, status FROM agent_runtimes WHERE id = ?',
  ).get(runtimeId) as RuntimeRow | undefined;

  if (!runtime || runtime.status !== 'online') {
    console.warn(`[callback] Runtime ${runtimeId} not found or offline, cannot stop agent ${agentId}`);
    return;
  }

  const event: RuntimeCallbackEvent = {
    type: 'stop',
  };

  sendCallbackWithRetry(runtime, agentId, event).catch((err) => {
    console.error(`[callback] Failed to notify runtime ${runtimeId} to stop agent ${agentId}:`, err);
  });
}
