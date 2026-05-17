import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'rejected' | 'error';

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo: ['in_progress'],
  in_progress: ['review', 'done', 'error'],
  review: ['done', 'rejected', 'in_progress'],
  done: [],
  rejected: ['todo'],
  error: ['in_progress'],
};

export interface CreateTaskRequest {
  room_id: string;
  title: string;
  description?: string;
  assigned_to?: string;
  required_capabilities?: string[];
  priority?: number;
  parent_task_id?: string;
  message_id?: string;
  orchestrator_id?: string;
}

export interface UpdateTaskRequest {
  status?: TaskStatus;
  assigned_to?: string;
  priority?: number;
  description?: string;
  orchestrator_id?: string;
}

export interface TaskInfo {
  id: string;
  room_id: string;
  parent_task_id: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  assigned_to: string | null;
  required_capabilities: string[];
  priority: number;
  retry_count: number;
  max_retries: number;
  message_id: string | null;
  orchestrator_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export function createTask(
  db: Database.Database,
  agentId: string,
  req: CreateTaskRequest,
): TaskInfo {
  if (!req.title || !req.room_id) {
    throw new ServerError(ErrorCode.VALIDATION_ERROR, 'title and room_id are required', false, 400);
  }

  // Room must exist and agent must be member
  const member = db.prepare(
    'SELECT 1 FROM room_members WHERE room_id = ? AND agent_id = ?',
  ).get(req.room_id, agentId);
  if (!member) {
    throw new ServerError(ErrorCode.NOT_ROOM_MEMBER, 'Not a member of this room', false, 403);
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO tasks (id, room_id, parent_task_id, title, description, status, assigned_to, required_capabilities, priority, message_id, orchestrator_id, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.room_id,
    req.parent_task_id ?? null,
    req.title,
    req.description ?? '',
    req.assigned_to ?? null,
    JSON.stringify(req.required_capabilities ?? []),
    req.priority ?? 0,
    req.message_id ?? null,
    req.orchestrator_id ?? null,
    agentId,
    now,
    now,
  );

  // Create task event
  db.prepare(`
    INSERT INTO task_events (id, task_id, event_type, actor_id, payload, created_at)
    VALUES (?, ?, 'created', ?, ?, ?)
  `).run(uuidv4(), id, agentId, JSON.stringify({ title: req.title }), now);

  return getTask(db, id);
}

export function getTask(db: Database.Database, taskId: string): TaskInfo {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new ServerError(ErrorCode.TASK_NOT_FOUND, 'Task not found', false, 404);
  }
  return rowToTask(row);
}

export function listTasks(
  db: Database.Database,
  query: { room_id?: string; status?: string; limit?: number; cursor?: string } = {},
): { tasks: TaskInfo[]; has_more: boolean; next_cursor: string | null } {
  const limit = Math.min(query.limit ?? 50, 100);
  const params: unknown[] = [];
  let where = 'WHERE 1=1';

  if (query.room_id) {
    where += ' AND room_id = ?';
    params.push(query.room_id);
  }
  if (query.status) {
    where += ' AND status = ?';
    params.push(query.status);
  }
  if (query.cursor) {
    where += ' AND created_at < ?';
    params.push(query.cursor);
  }

  params.push(limit + 1);
  const rows = db.prepare(
    `SELECT * FROM tasks ${where} ORDER BY priority DESC, created_at ASC LIMIT ?`,
  ).all(...params) as Record<string, unknown>[];

  const hasMore = rows.length > limit;
  const tasks = rows.slice(0, limit).map(rowToTask);

  return {
    tasks,
    has_more: hasMore,
    next_cursor: hasMore && tasks.length > 0 ? tasks[tasks.length - 1].created_at : null,
  };
}

export function updateTask(
  db: Database.Database,
  taskId: string,
  agentId: string,
  req: UpdateTaskRequest,
): TaskInfo {
  const task = getTask(db, taskId);

  if (req.status) {
    if (!VALID_TRANSITIONS[task.status]?.includes(req.status)) {
      throw new ServerError(
        ErrorCode.INVALID_STATUS_TRANSITION,
        `Cannot transition from '${task.status}' to '${req.status}'`,
        false,
        400,
      );
    }
  }

  const now = new Date().toISOString();
  const updates: string[] = [];
  const values: unknown[] = [];

  if (req.status !== undefined) {
    updates.push('status = ?');
    values.push(req.status);
    if (req.status === 'done') {
      updates.push('completed_at = ?');
      values.push(now);
    }
  }
  if (req.assigned_to !== undefined) {
    updates.push('assigned_to = ?');
    values.push(req.assigned_to);
  }
  if (req.priority !== undefined) {
    updates.push('priority = ?');
    values.push(req.priority);
  }
  if (req.description !== undefined) {
    updates.push('description = ?');
    values.push(req.description);
  }
  if (req.orchestrator_id !== undefined) {
    updates.push('orchestrator_id = ?');
    values.push(req.orchestrator_id);
  }

  if (updates.length === 0) {
    return task;
  }

  updates.push('updated_at = ?');
  values.push(now);
  values.push(taskId);

  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  // Log status transition event
  if (req.status !== undefined) {
    db.prepare(`
      INSERT INTO task_events (id, task_id, event_type, actor_id, payload, created_at)
      VALUES (?, ?, 'status_changed', ?, ?, ?)
    `).run(uuidv4(), taskId, agentId, JSON.stringify({ from_status: task.status, to_status: req.status }), now);
  }

  return getTask(db, taskId);
}

function rowToTask(row: Record<string, unknown>): TaskInfo {
  return {
    id: row.id as string,
    room_id: row.room_id as string,
    parent_task_id: row.parent_task_id as string | null,
    title: row.title as string,
    description: (row.description as string) ?? '',
    status: row.status as TaskStatus,
    assigned_to: row.assigned_to as string | null,
    required_capabilities: JSON.parse((row.required_capabilities as string) ?? '[]'),
    priority: row.priority as number,
    retry_count: row.retry_count as number,
    max_retries: row.max_retries as number,
    message_id: row.message_id as string | null,
    orchestrator_id: row.orchestrator_id as string | null,
    created_by: row.created_by as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    completed_at: row.completed_at as string | null,
  };
}
