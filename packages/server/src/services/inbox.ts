/**
 * Agent inbox + todo queue services.
 *
 * pending_messages: messages delivered to a busy agent, awaiting injection at
 * the agent's next tool boundary. agent_todos: an agent's private self-managed
 * task queue. Both are read by the PostToolUse hook and exposed via
 * flock_todo_* MCP tools.
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface PendingMessage {
  id: string;
  agent_id: string;
  source_type: 'dm' | 'mention' | 'system';
  sender_id: string | null;
  sender_name: string;
  content: string;
  ref_id: string | null;
  delivered: number;
  created_at: string;
}

export interface AgentTodo {
  id: string;
  agent_id: string;
  content: string;
  source_message_id: string | null;
  priority: number;
  status: 'open' | 'done' | 'dropped';
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** Enqueue a message into an agent's inbox (called when the agent is busy). */
export function enqueuePendingMessage(
  db: Database.Database,
  params: {
    agentId: string;
    sourceType: 'dm' | 'mention' | 'system';
    senderId?: string | null;
    senderName?: string;
    content: string;
    refId?: string | null;
  },
): PendingMessage {
  const now = new Date().toISOString();
  const row: PendingMessage = {
    id: randomUUID(),
    agent_id: params.agentId,
    source_type: params.sourceType,
    sender_id: params.senderId ?? null,
    sender_name: params.senderName ?? '',
    content: params.content,
    ref_id: params.refId ?? null,
    delivered: 0,
    created_at: now,
  };
  db.prepare(
    `INSERT INTO pending_messages (id, agent_id, source_type, sender_id, sender_name, content, ref_id, delivered, created_at)
     VALUES (@id, @agent_id, @source_type, @sender_id, @sender_name, @content, @ref_id, @delivered, @created_at)`,
  ).run(row);
  return row;
}

/** Read undelivered pending messages for an agent (does NOT mark delivered). */
export function peekPendingMessages(db: Database.Database, agentId: string, limit = 10): PendingMessage[] {
  return db.prepare(
    `SELECT * FROM pending_messages WHERE agent_id = ? AND delivered = 0 ORDER BY created_at ASC LIMIT ?`,
  ).all(agentId, limit) as PendingMessage[];
}

/** Mark a set of pending messages as delivered (after injecting once). */
export function markDelivered(db: Database.Database, ids: string[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE pending_messages SET delivered = 1 WHERE id IN (${placeholders})`).run(...ids);
}
