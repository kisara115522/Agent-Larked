/**
 * Build the inbox + todo digest injected at every tool boundary via the
 * PostToolUse hook. This is the mechanism that guarantees a busy agent learns
 * about new messages and never forgets open todos — independent of model diligence.
 */
import type Database from 'better-sqlite3';
import { peekPendingMessages, markDelivered, listOpenTodos } from './inbox.js';

export interface InboxDigest {
  new_messages: Array<{ from: string; content: string; age: string; source: string }>;
  open_todos: Array<{ id: string; content: string; priority: number }>;
  guidance: string;
}

export function ageString(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

/**
 * Build the digest for an agent. Marks peeked messages delivered so they are
 * announced once (not re-spammed every tool call); open todos persist until
 * explicitly completed so they keep reminding the model.
 */
export function buildInboxDigest(db: Database.Database, agentId: string): InboxDigest | null {
  const pending = peekPendingMessages(db, agentId);
  const todos = listOpenTodos(db, agentId);

  if (pending.length === 0 && todos.length === 0) return null;

  const digest: InboxDigest = {
    new_messages: pending.map((m) => ({
      from: m.sender_name || m.sender_id || 'unknown',
      content: m.content.slice(0, 500),
      age: ageString(m.created_at),
      source: m.source_type,
    })),
    open_todos: todos.map((t) => ({ id: t.id, content: t.content.slice(0, 300), priority: t.priority })),
    guidance: buildGuidance(pending.length, todos.length),
  };

  // Announce each new message once.
  if (pending.length > 0) markDelivered(db, pending.map((m) => m.id));

  return digest;
}

function buildGuidance(numMsgs: number, numTodos: number): string {
  const parts: string[] = [];
  if (numMsgs > 0) {
    parts.push(
      `You have ${numMsgs} new message(s) that arrived while you were working. ` +
      `For EACH: decide now — (a) handle it immediately if it's quick or urgent (reply via flock_dm_send / flock_post), ` +
      `or (b) if your current work is more important, capture it with flock_todo_add so you don't forget, then continue. ` +
      `Do NOT silently ignore it — either act or enqueue.`,
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
