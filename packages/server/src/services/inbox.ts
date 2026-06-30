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
  source_type: 'dm' | 'mention' | 'system' | 'room';
  sender_id: string | null;
  sender_name: string;
  content: string;
  ref_id: string | null;
  room_id: string | null;
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
    sourceType: 'dm' | 'mention' | 'system' | 'room';
    senderId?: string | null;
    senderName?: string;
    content: string;
    refId?: string | null;
    roomId?: string | null;
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
    room_id: params.roomId ?? null,
    delivered: 0,
    created_at: now,
  };
  db.prepare(
    `INSERT INTO pending_messages (id, agent_id, source_type, sender_id, sender_name, content, ref_id, room_id, delivered, created_at)
     VALUES (@id, @agent_id, @source_type, @sender_id, @sender_name, @content, @ref_id, @room_id, @delivered, @created_at)`,
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

/**
 * Enqueue a room message into the inbox of every BUSY (active/spawning) member
 * of the room (excluding the sender). Dormant members are skipped — they get
 * woken via the normal wake path. This mirrors the DM busy-agent branch.
 *
 * `onlyAgentIds`: when non-empty, restrict injection to the intersection of
 * busy members and these ids. This keeps inbox injection symmetric with the
 * dormant wake path — an @mention only injects/wakes the mentioned agents,
 * while a broadcast (no mention) injects/wakes everyone busy. When omitted
 * (broadcast), all busy members are injected.
 */
export function enqueueRoomMessageForBusyAgents(
  db: Database.Database,
  params: {
    roomId: string;
    senderId: string;
    senderName: string;
    excerpt: string;
    messageId?: string | null;
    onlyAgentIds?: string[];
  },
): void {
  let busyMembers = db.prepare(`
    SELECT rm.agent_id
    FROM room_members rm
    JOIN profiles p ON p.id = rm.agent_id
    WHERE rm.room_id = ? AND rm.agent_id != ? AND p.status IN ('active', 'spawning')
  `).all(params.roomId, params.senderId) as { agent_id: string }[];

  // @mention precision: only the intersection; broadcast: all busy members.
  if (params.onlyAgentIds && params.onlyAgentIds.length > 0) {
    const set = new Set(params.onlyAgentIds);
    busyMembers = busyMembers.filter((m) => set.has(m.agent_id));
  }

  for (const { agent_id } of busyMembers) {
    enqueuePendingMessage(db, {
      agentId: agent_id,
      sourceType: 'room',
      senderId: params.senderId,
      senderName: params.senderName,
      content: params.excerpt,
      refId: params.messageId ?? null,
      roomId: params.roomId,
    });
  }
}

/** Add a todo to an agent's private queue. */
export function addTodo(
  db: Database.Database,
  params: { agentId: string; content: string; priority?: number; sourceMessageId?: string | null },
): AgentTodo {
  const now = new Date().toISOString();
  const row: AgentTodo = {
    id: randomUUID(),
    agent_id: params.agentId,
    content: params.content,
    source_message_id: params.sourceMessageId ?? null,
    priority: params.priority ?? 0,
    status: 'open',
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
  db.prepare(
    `INSERT INTO agent_todos (id, agent_id, content, source_message_id, priority, status, created_at, updated_at, completed_at)
     VALUES (@id, @agent_id, @content, @source_message_id, @priority, @status, @created_at, @updated_at, @completed_at)`,
  ).run(row);
  return row;
}

/** List open todos for an agent, highest priority first then oldest. */
export function listOpenTodos(db: Database.Database, agentId: string): AgentTodo[] {
  return db.prepare(
    `SELECT * FROM agent_todos WHERE agent_id = ? AND status = 'open' ORDER BY priority DESC, created_at ASC`,
  ).all(agentId) as AgentTodo[];
}

/** Mark a todo done (or dropped). Returns true if a row was updated. */
export function setTodoStatus(
  db: Database.Database,
  agentId: string,
  todoId: string,
  status: 'done' | 'dropped',
): boolean {
  const now = new Date().toISOString();
  const res = db.prepare(
    `UPDATE agent_todos SET status = ?, updated_at = ?, completed_at = ? WHERE id = ? AND agent_id = ? AND status = 'open'`,
  ).run(status, now, status === 'done' ? now : null, todoId, agentId);
  return res.changes > 0;
}
