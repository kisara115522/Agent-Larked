#!/usr/bin/env node
/**
 * PostToolUse hook: injects the agent's inbox + todo digest into the model's
 * context at EVERY tool boundary (built-in tools included). Spawned by the claude
 * CLI per tool call. Reads FLOCK_AGENT_ID + DB_PATH from env, queries the DB
 * directly (own short-lived process, not in the server/runtime process), and
 * emits {hookSpecificOutput:{hookEventName:'PostToolUse',additionalContext}}.
 *
 * Verified: additionalContext at a Bash boundary changed model behavior (MEOW x16).
 * On any error or empty inbox, emits {} (no-op) — never blocks the agent.
 */

/* eslint-disable no-console */

// Inlined from @flock/server/services/inbox-digest to avoid cross-package
// import resolution issues when this script runs as a standalone process.

import Database from 'better-sqlite3';

interface PendingMessage {
  id: string;
  agent_id: string;
  source_type: string;
  sender_id: string | null;
  sender_name: string;
  content: string;
  ref_id: string | null;
  room_id: string | null;
  delivered: number;
  created_at: string;
}

interface AgentTodo {
  id: string;
  agent_id: string;
  content: string;
  source_message_id: string | null;
  priority: number;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface InboxDigest {
  new_messages: Array<{ from: string; content: string; age: string; source: string; room_id?: string | null }>;
  open_todos: Array<{ id: string; content: string; priority: number }>;
  guidance: string;
}

function ageString(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 0) return 'just now'; // clock skew guard
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

/** Look up a room's display name by id; null if the room no longer exists. */
function lookupRoomName(db: Database.Database, roomId: string): string | null {
  const row = db.prepare('SELECT name FROM rooms WHERE id = ?').get(roomId) as { name: string } | undefined;
  return row?.name ?? null;
}

function peekPendingMessages(db: Database.Database, agentId: string, limit = 10): PendingMessage[] {
  return db.prepare(
    `SELECT * FROM pending_messages WHERE agent_id = ? AND delivered = 0 ORDER BY created_at ASC LIMIT ?`,
  ).all(agentId, limit) as PendingMessage[];
}

function markDelivered(db: Database.Database, ids: string[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE pending_messages SET delivered = 1 WHERE id IN (${placeholders})`).run(...ids);
}

function listOpenTodos(db: Database.Database, agentId: string): AgentTodo[] {
  return db.prepare(
    `SELECT * FROM agent_todos WHERE agent_id = ? AND status = 'open' ORDER BY priority DESC, created_at ASC`,
  ).all(agentId) as AgentTodo[];
}

function buildGuidance(pending: Array<{ source_type: string }>, numTodos: number): string {
  const parts: string[] = [];
  const numMsgs = pending.length;
  if (numMsgs > 0) {
    const hasRoom = pending.some((m) => m.source_type === 'room');
    const roomHint = hasRoom
      ? ` For room messages (source=room), call flock_room_sync with the room_id to read full context before replying via flock_post.`
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

function buildInboxDigest(db: Database.Database, agentId: string): InboxDigest | null {
  const run = db.transaction(() => {
    const pending = peekPendingMessages(db, agentId);
    const todos = listOpenTodos(db, agentId);

    if (pending.length === 0 && todos.length === 0) return null;

    const digest: InboxDigest = {
      new_messages: pending.map((m) => {
        const sender = m.sender_name || m.sender_id || 'unknown';
        // Mirror of @flock/server inbox-digest: surface room name in `from`
        // ("<sender> in #<roomName>") so the model knows the source room.
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
        };
      }),
      open_todos: todos.map((t) => ({ id: t.id, content: t.content.slice(0, 300), priority: t.priority })),
      guidance: buildGuidance(pending, todos.length),
    };

    if (pending.length > 0) markDelivered(db, pending.map((m) => m.id));

    return digest;
  });

  return run();
}

function emitNoop(): never {
  process.stdout.write('{}\n');
  process.exit(0);
}

async function main(): Promise<void> {
  // Drain stdin (the PostToolUse event JSON); we don't need its content.
  await new Promise<void>((resolve) => {
    let buf = '';
    process.stdin.on('data', (d: Buffer) => { buf += d.toString(); if (buf.length > 1_000_000) resolve(); });
    process.stdin.on('end', () => resolve());
    process.stdin.on('error', () => resolve());
    setTimeout(resolve, 500);
  });

  const agentId = process.env.FLOCK_AGENT_ID;
  const dbPath = process.env.DB_PATH;
  if (!agentId || !dbPath) emitNoop();

  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath!, { readonly: false });
    db.pragma('busy_timeout = 3000');
    const digest = buildInboxDigest(db, agentId!);
    if (!digest) emitNoop();
    const text =
      'FLOCK INBOX — new messages and/or your open todos arrived while you were working:\n' +
      JSON.stringify(digest, null, 2) +
      '\n(See your system instructions on handling _flock_inbox: act now, or flock_todo_add to enqueue. Never silently ignore.)';
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text },
    }) + '\n');
    process.exit(0);
  } catch {
    emitNoop();
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

void main();
