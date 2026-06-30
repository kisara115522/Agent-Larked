/**
 * Build the inbox + todo digest injected at every tool boundary via the
 * PostToolUse hook. This is the mechanism that guarantees a busy agent learns
 * about new messages and never forgets open todos — independent of model diligence.
 */
import type Database from 'better-sqlite3';
import { peekPendingMessages, markDelivered, listOpenTodos } from './inbox.js';

export interface InboxDigest {
  new_messages: Array<{ from: string; content: string; age: string; source: string; room_id?: string | null; message_id?: string | null }>;
  open_todos: Array<{ id: string; content: string; priority: number }>;
  guidance: string;
}

/** Look up a room's display name by id; null if the room no longer exists. */
function lookupRoomName(db: Database.Database, roomId: string): string | null {
  const row = db.prepare('SELECT name FROM rooms WHERE id = ?').get(roomId) as { name: string } | undefined;
  return row?.name ?? null;
}

export function ageString(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 0) return 'just now'; // clock skew guard
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

/**
 * Build the digest for an agent. Marks peeked messages delivered so they are
 * announced once (not re-spammed every tool call); open todos persist until
 * explicitly completed so they keep reminding the model.
 */
/**
 * Build the digest for an agent. Wrapped in a transaction so that peek +
 * markDelivered is atomic — prevents two concurrent hook processes from
 * seeing the same undelivered messages and injecting them twice.
 */
export function buildInboxDigest(db: Database.Database, agentId: string): InboxDigest | null {
  const run = db.transaction(() => {
    const pending = peekPendingMessages(db, agentId);
    const todos = listOpenTodos(db, agentId);

    if (pending.length === 0 && todos.length === 0) return null;

    const digest: InboxDigest = {
      new_messages: pending.map((m) => {
        const sender = m.sender_name || m.sender_id || 'unknown';
        // For room messages, surface the room name in `from` ("<sender> in
        // #<roomName>") so the model knows WHERE the message came from without
        // parsing the room_id JSON field. Falls back to the raw id if the room
        // was deleted / name missing.
        const roomName = m.room_id ? lookupRoomName(db, m.room_id) : null;
        const from =
          m.source_type === 'room' && m.room_id
            ? `${sender} in #${roomName ?? m.room_id}`
            : sender;
        return {
          from,
          content: m.content.slice(0, 500),
          age: ageString(m.created_at),
          source: m.source_type,
          ...(m.room_id ? { room_id: m.room_id } : {}),
          // Expose the source message id (stored in ref_id) so the model can
          // dedup against flock_wait, which may later return the same message.
          ...(m.source_type === 'room' && m.ref_id ? { message_id: m.ref_id } : {}),
        };
      }),
      open_todos: todos.map((t) => ({ id: t.id, content: t.content.slice(0, 300), priority: t.priority })),
      guidance: buildGuidance(pending, todos.length),
    };

    // Announce each new message once.
    if (pending.length > 0) markDelivered(db, pending.map((m) => m.id));

    return digest;
  });

  return run();
}

function buildGuidance(pending: Array<{ source_type: string }>, numTodos: number): string {
  const parts: string[] = [];
  const numMsgs = pending.length;
  if (numMsgs > 0) {
    const hasRoom = pending.some((m) => m.source_type === 'room');
    const roomHint = hasRoom
      ? ` For room messages (source=room), call flock_room_sync with the room_id to read full context before replying via flock_post.` +
        ` Each room message carries a message_id — the same message may also surface when you call flock_wait; same message_id means the same message, so handle it once and don't double-reply.`
      : '';
    parts.push(
      `You have ${numMsgs} new message(s) that arrived while you were working. ` +
      `For EACH: decide now — (a) handle it immediately if it's quick or urgent (reply via flock_dm_send / flock_post), ` +
      `or (b) if your current work is more important, capture it with flock_todo_add so you don't forget, then continue. ` +
      `Do NOT silently ignore it — either act or enqueue.${roomHint}`,
    );
  }
  if (numTodos > 0) {
    parts.push(
      `You have ${numTodos} open todo(s) above. When you reach a natural stopping point in your current work, ` +
      `address the highest-priority open todo. When you finish one, call flock_todo_complete with its id.`,
    );
  }
  return parts.join(' ');
}
