import { createHmac, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { regenerateToken } from './identity.js';
import { cleanupStaleRuntimes, selectAvailableRuntime } from './runtime.js';

export interface CallbackEvent {
  type: 'spawn' | 'stop' | 'wake';
  agent_token?: string;
  agent_name?: string;
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
}

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
  prompt: string | undefined,
): WakeSession | null {
  const runtime = db.prepare(
    'SELECT id, callback_url, callback_secret, status FROM agent_runtimes WHERE id = ?',
  ).get(runtimeId) as RuntimeRow | undefined;
  if (!runtime || runtime.status !== 'online') return null;

  const agent = db.prepare('SELECT name, model, status FROM profiles WHERE id = ?').get(agentId) as { name: string; model: string | null; status: string } | undefined;
  if (!agent) return null;
  if (agent.status === 'active') return null;

  const { token } = regenerateToken(db, agentId);
  const now = new Date().toISOString();
  db.prepare("UPDATE agent_spawns SET status = 'stopped', last_active_at = ? WHERE agent_id = ? AND status = 'spawning'").run(now, agentId);
  db.prepare(`
    INSERT INTO agent_spawns (id, agent_id, runtime_id, status, spawned_at, last_active_at, prompt)
    VALUES (?, ?, ?, 'spawning', ?, ?, ?)
  `).run(randomUUID(), agentId, runtimeId, now, now, prompt ?? null);
  db.prepare("UPDATE profiles SET status = 'spawning', updated_at = ? WHERE id = ?").run(now, agentId);

  return { runtime, agent, token };
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

function recentRoomContext(db: Database.Database, roomId: string, limit = 10): string {
  const rows = db.prepare(`
    SELECT m.content, m.sequence, p.name, p.display_name
    FROM messages m
    LEFT JOIN profiles p ON p.id = m.from_agent
    WHERE m.room_id = ?
    ORDER BY m.sequence DESC
    LIMIT ?
  `).all(roomId, limit) as Array<{ content: string; sequence: number; name: string | null; display_name: string | null }>;

  return rows
    .reverse()
    .map((row) => {
      const sender = row.display_name || row.name || 'unknown';
      return `#${row.sequence} ${sender}: ${row.content}`;
    })
    .join('\n');
}

function roomWakePrompt(
  db: Database.Database,
  roomId: string,
  roomName: string,
  reason: string,
  fallbackExcerpt?: string,
): string {
  const context = recentRoomContext(db, roomId);
  const recent = context || (fallbackExcerpt ? `Recent message: ${fallbackExcerpt}` : 'No recent messages are available.');
  return [
    `You were woken in room "${roomName}" (${roomId}) because ${reason}.`,
    'Recent room messages:',
    recent,
    'Use the Flock MCP tools to inspect the room or task if needed, then respond in this room only when a response is useful. Do not post in other rooms.',
  ].join('\n\n');
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
    const runtime = selectRuntimeForWake(db, agentId);
    if (!runtime) continue;

    const prompt = roomWakePrompt(db, roomId, roomName, `${senderName} mentioned you`, excerpt);
    const session = createWakeSession(db, agentId, runtime.id, prompt);
    if (!session) continue;

    const event: CallbackEvent = {
      type: 'wake',
      trigger_type: 'mention',
      ...agentCallbackFields(db, agentId, session.agent, session.token),
      prompt,
      room_id: roomId,
      room_name: roomName,
      message_id: messageId,
      sender_name: senderName,
      excerpt,
    };

    // Fire and forget — don't block the message response
    sendCallbackWithRetry(runtime, agentId, event).catch((err) => {
      console.error(`[callback] Failed to wake agent ${agentId} via runtime ${runtime.id}:`, err);
    });

    // Log wake event
    logWakeEvent(db, agentId, triggeredById, 'mention', 'sent', roomId, prompt);
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
    const runtime = selectRuntimeForWake(db, agent_id);
    if (!runtime) continue;

    const prompt = roomWakePrompt(db, roomId, roomName, `${senderName} sent a broadcast wake`, excerpt);
    const session = createWakeSession(db, agent_id, runtime.id, prompt);
    if (!session) continue;

    const event: CallbackEvent = {
      type: 'wake',
      trigger_type: 'broadcast',
      ...agentCallbackFields(db, agent_id, session.agent, session.token),
      prompt,
      room_id: roomId,
      room_name: roomName,
    };

    sendCallbackWithRetry(runtime, agent_id, event).catch((err) => {
      console.error(`[callback] Failed to wake agent ${agent_id} via runtime ${runtime.id}:`, err);
    });

    // Log wake event
    logWakeEvent(db, agent_id, senderName, 'broadcast', 'sent', roomId, prompt);
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
  const session = createWakeSession(db, agentId, runtime.id, prompt);
  if (!session) return;

  const event: CallbackEvent = {
    type: 'wake',
    trigger_type: 'direct_message',
    ...agentCallbackFields(db, agentId, session.agent, session.token),
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
    'Recent room messages:',
    recentRoomContext(db, roomId) || 'No recent messages are available.',
    'Use the Flock task tools to inspect the task, update its status, and post progress in the room if appropriate.',
  ].join('\n\n');
  const session = createWakeSession(db, agentId, runtime.id, prompt);
  if (!session) return;

  const event: RuntimeCallbackEvent = {
    type: 'wake',
    trigger_type: 'task_assignment',
    ...agentCallbackFields(db, agentId, session.agent, session.token),
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
