import { createHmac, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface CallbackEvent {
  type: 'mention' | 'room_activity';
  room_id: string;
  room_name: string;
  message_id: string;
  sender_name: string;
  excerpt: string;
}

export interface RuntimeCallbackEvent {
  type: 'spawn' | 'stop' | 'wake';
  prompt?: string;
  room_id?: string;
  room_name?: string;
  sender_name?: string;
  excerpt?: string;
}

interface RuntimeRow {
  id: string;
  callback_url: string;
  callback_secret: string | null;
  status: string;
}

/** Log a wake event to the wake_events table */
function logWakeEvent(
  db: Database.Database,
  agentId: string,
  triggeredBy: string,
  triggerType: string,
  roomId?: string,
  prompt?: string,
): void {
  db.prepare(`
    INSERT INTO wake_events (id, agent_id, triggered_by, trigger_type, room_id, prompt, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), agentId, triggeredBy, triggerType, roomId ?? null, prompt ?? null, new Date().toISOString());
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
 * Looks up each mentioned agent's active spawn, finds the runtime, sends callback.
 */
export function wakeMentionedAgents(
  db: Database.Database,
  mentionedAgentIds: string[],
  roomId: string,
  messageId: string,
  senderName: string,
  excerpt: string,
): void {
  if (mentionedAgentIds.length === 0) return;

  // Get room name
  const room = db.prepare('SELECT name FROM rooms WHERE id = ?').get(roomId) as { name: string } | undefined;
  const roomName = room?.name ?? roomId;

  for (const agentId of mentionedAgentIds) {
    // Find active spawn for this agent
    const spawn = db.prepare(
      "SELECT runtime_id FROM agent_spawns WHERE agent_id = ? AND status = 'active' ORDER BY spawned_at DESC LIMIT 1",
    ).get(agentId) as { runtime_id: string } | undefined;

    if (!spawn) continue;

    // Get runtime info
    const runtime = db.prepare(
      'SELECT id, callback_url, callback_secret, status FROM agent_runtimes WHERE id = ?',
    ).get(spawn.runtime_id) as RuntimeRow | undefined;

    if (!runtime || runtime.status !== 'online') continue;

    const event: CallbackEvent = {
      type: 'mention',
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
    logWakeEvent(db, agentId, senderName, 'mention', roomId);
  }
}

/**
 * Wake all dormant agents in a room (broadcast wake).
 * Used when a human sends a message — all dormant agents in the room get notified.
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

  // Find all room members that have active spawns and are dormant
  const dormantAgents = db.prepare(`
    SELECT rm.agent_id, sp.runtime_id
    FROM room_members rm
    JOIN profiles p ON p.id = rm.agent_id
    JOIN agent_spawns sp ON sp.agent_id = rm.agent_id AND sp.status = 'active'
    WHERE rm.room_id = ? AND p.status = 'dormant' AND rm.agent_id != ?
  `).all(roomId, senderId) as { agent_id: string; runtime_id: string }[];

  for (const { agent_id, runtime_id } of dormantAgents) {
    const runtime = db.prepare(
      'SELECT id, callback_url, callback_secret, status FROM agent_runtimes WHERE id = ?',
    ).get(runtime_id) as RuntimeRow | undefined;

    if (!runtime || runtime.status !== 'online') continue;

    const event: CallbackEvent = {
      type: 'room_activity',
      room_id: roomId,
      room_name: roomName,
      message_id: '',
      sender_name: senderName,
      excerpt,
    };

    sendCallbackWithRetry(runtime, agent_id, event).catch((err) => {
      console.error(`[callback] Failed to wake agent ${agent_id} via runtime ${runtime_id}:`, err);
    });

    // Log wake event
    logWakeEvent(db, agent_id, senderName, 'broadcast', roomId);
  }
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
    prompt: prompt ?? undefined,
  };

  sendCallbackWithRetry(runtime, agentId, event).catch((err) => {
    console.error(`[callback] Failed to notify runtime ${runtimeId} to spawn agent ${agentId}:`, err);
  });
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
