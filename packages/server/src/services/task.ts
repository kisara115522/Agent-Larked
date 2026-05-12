import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type {
  CreateTaskRequest,
  CreateTaskResponse,
  ListTasksQuery,
  ListTasksResponse,
  GetTaskResponse,
  AddTaskEventRequest,
  AddTaskEventResponse,
  AddTaskArtifactRequest,
  AddTaskArtifactResponse,
  Task,
  TaskEvent,
  TaskArtifact,
  TaskStatus,
  TaskPriority,
  TaskEventType,
  ArtifactType,
} from '@flock/shared';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';
import { isRoomMember } from './room.js';

// Status machine: allowed transitions
const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  open: ['accepted', 'in_progress', 'completed', 'cancelled'],
  accepted: ['in_progress', 'blocked', 'completed', 'cancelled'],
  in_progress: ['blocked', 'completed', 'cancelled'],
  blocked: ['in_progress', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

const TERMINAL_STATUSES: Set<TaskStatus> = new Set(['completed', 'cancelled']);

const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const VALID_ARTIFACT_TYPES: Set<ArtifactType> = new Set(['text', 'json', 'code', 'uri']);

function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTaskParticipant(
  db: Database.Database,
  taskId: string,
  agentId: string,
): boolean {
  const task = db.prepare('SELECT created_by FROM tasks WHERE id = ?').get(taskId) as { created_by: string } | undefined;
  if (!task) return false;
  if (task.created_by === agentId) return true;

  const assignee = db.prepare(
    'SELECT 1 FROM task_assignees WHERE task_id = ? AND agent_id = ?',
  ).get(taskId, agentId);
  if (assignee) return true;

  const profile = db.prepare('SELECT is_admin FROM profiles WHERE id = ?').get(agentId) as { is_admin: number } | undefined;
  return profile?.is_admin === 1;
}

function checkIdempotency(
  db: Database.Database,
  agentId: string,
  key: string,
  requestHash: string,
): unknown | null {
  const existing = db.prepare(
    'SELECT request_hash, response FROM task_idempotency_keys WHERE agent_id = ? AND key = ?',
  ).get(agentId, key) as { request_hash: string; response: string } | undefined;

  if (existing) {
    if (existing.request_hash === requestHash) {
      return JSON.parse(existing.response);
    }
    throw new ServerError(ErrorCode.IDEMPOTENCY_CONFLICT, 'Idempotency key conflict', false, 409);
  }
  return null;
}

function storeIdempotency(
  db: Database.Database,
  agentId: string,
  key: string,
  requestHash: string,
  response: unknown,
): void {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO task_idempotency_keys (agent_id, key, request_hash, response, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(agentId, key, requestHash, JSON.stringify(response), expiresAt);
}

function nextCreatedOrder(db: Database.Database): number {
  const row = db.prepare(
    'SELECT COALESCE(MAX(created_order), 0) + 1 AS next_order FROM task_events',
  ).get() as { next_order: number };
  return row.next_order;
}

export function createTask(
  db: Database.Database,
  agentId: string,
  req: CreateTaskRequest,
): CreateTaskResponse {
  // 1. Validate title
  if (!req.title || req.title.length < 1 || req.title.length > 200) {
    throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Title must be 1-200 characters');
  }

  // 2. Validate description size (16 KiB)
  if (req.description && Buffer.byteLength(req.description, 'utf-8') > 16_384) {
    throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Description exceeds 16 KiB limit');
  }

  // 3. Validate priority
  if (req.priority && !VALID_PRIORITIES.has(req.priority)) {
    throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Invalid priority');
  }

  // 4. Room must exist and caller must be member
  const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(req.room_id);
  if (!room) {
    throw new ServerError(ErrorCode.ROOM_NOT_FOUND, 'Room not found', false, 404);
  }
  if (!isRoomMember(db, req.room_id, agentId)) {
    throw new ServerError(ErrorCode.NOT_ROOM_MEMBER, 'Not a member of this room', false, 403);
  }

  // 5. Validate origin_message_id belongs to same room
  if (req.origin_message_id) {
    const msg = db.prepare('SELECT room_id FROM messages WHERE id = ?').get(req.origin_message_id) as { room_id: string } | undefined;
    if (!msg || msg.room_id !== req.room_id) {
      throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Origin message not found in this room');
    }
  }

  // 6. Validate assignees exist and are room members
  if (req.assignees && req.assignees.length > 0) {
    for (const assigneeId of req.assignees) {
      const profile = db.prepare('SELECT id FROM profiles WHERE id = ?').get(assigneeId);
      if (!profile) {
        throw new ServerError(ErrorCode.AGENT_NOT_FOUND, `Assignee ${assigneeId} not found`);
      }
      if (!isRoomMember(db, req.room_id, assigneeId)) {
        throw new ServerError(ErrorCode.NOT_ROOM_MEMBER, `Assignee ${assigneeId} is not a room member`, false, 403);
      }
    }
  }

  // 7. Idempotency check
  const requestHash = createHash('sha256').update(JSON.stringify(req)).digest('hex');
  const cached = checkIdempotency(db, agentId, req.idempotency_key, requestHash);
  if (cached !== null) {
    return cached as CreateTaskResponse;
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  const result = db.transaction(() => {
    db.prepare(`
      INSERT INTO tasks (id, room_id, title, description, status, priority, created_by, origin_message_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
    `).run(
      id,
      req.room_id,
      req.title,
      req.description ?? '',
      req.priority ?? 'normal',
      agentId,
      req.origin_message_id ?? null,
      now,
      now,
    );

    // Insert assignees
    const assigneeIds: string[] = [];
    if (req.assignees && req.assignees.length > 0) {
      const assignStmt = db.prepare(
        'INSERT INTO task_assignees (task_id, agent_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?)',
      );
      for (const assigneeId of req.assignees) {
        assignStmt.run(id, assigneeId, agentId, now);
        assigneeIds.push(assigneeId);
      }
    }

    // Write 'created' event
    const createdEventId = uuidv4();
    const createdOrder = nextCreatedOrder(db);
    db.prepare(`
      INSERT INTO task_events (id, task_id, actor_id, type, body, metadata, created_at, created_order)
      VALUES (?, ?, ?, 'created', '', '{}', ?, ?)
    `).run(createdEventId, id, agentId, now, createdOrder);

    // Write 'assignees_changed' event if assignees present
    if (assigneeIds.length > 0) {
      const assignEventId = uuidv4();
      const assignOrder = nextCreatedOrder(db);
      db.prepare(`
        INSERT INTO task_events (id, task_id, actor_id, type, body, metadata, created_at, created_order)
        VALUES (?, ?, ?, 'assignees_changed', '', ?, ?, ?)
      `).run(assignEventId, id, agentId, JSON.stringify({ added: assigneeIds }), now, assignOrder);
    }

    const response: CreateTaskResponse = {
      id,
      room_id: req.room_id,
      title: req.title,
      description: req.description ?? '',
      status: 'open',
      priority: (req.priority ?? 'normal') as CreateTaskResponse['priority'],
      created_by: agentId,
      origin_message_id: req.origin_message_id ?? null,
      assignees: assigneeIds,
      created_at: now,
      updated_at: now,
      completed_at: null,
      cancelled_at: null,
    };

    storeIdempotency(db, agentId, req.idempotency_key, requestHash, response);

    return response;
  })();

  return result;
}

export function listTasks(
  db: Database.Database,
  agentId: string,
  query: ListTasksQuery = {},
): ListTasksResponse {
  const limit = Math.min(query.limit ?? 20, 100);
  const conditions: string[] = [];
  const params: unknown[] = [];

  // Visibility: only tasks in rooms the agent is a member of
  conditions.push(`
    t.room_id IN (SELECT room_id FROM room_members WHERE agent_id = ?)
  `);
  params.push(agentId);

  if (query.room_id) {
    conditions.push('t.room_id = ?');
    params.push(query.room_id);
  }

  if (query.status) {
    conditions.push('t.status = ?');
    params.push(query.status);
  }

  if (query.created_by) {
    conditions.push('t.created_by = ?');
    params.push(query.created_by);
  }

  if (query.assignee_id) {
    conditions.push('t.id IN (SELECT task_id FROM task_assignees WHERE agent_id = ?)');
    params.push(query.assignee_id);
  }

  // Cursor: composite {updated_at, id}
  if (query.cursor) {
    try {
      const cursorData = JSON.parse(Buffer.from(query.cursor, 'base64').toString()) as { updated_at: string; id: string };
      conditions.push('(t.updated_at < ? OR (t.updated_at = ? AND t.id < ?))');
      params.push(cursorData.updated_at, cursorData.updated_at, cursorData.id);
    } catch {
      // Invalid cursor, ignore
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit + 1);
  const rows = db.prepare(`
    SELECT t.* FROM tasks t ${where}
    ORDER BY t.updated_at DESC, t.id DESC
    LIMIT ?
  `).all(...params) as Record<string, unknown>[];

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);

  const tasks = items.map((row) => {
    const assignees = db.prepare(
      'SELECT agent_id FROM task_assignees WHERE task_id = ?',
    ).all(row.id as string) as { agent_id: string }[];

    return {
      id: row.id as string,
      room_id: row.room_id as string,
      title: row.title as string,
      description: row.description as string,
      status: row.status as TaskStatus,
      priority: row.priority as TaskPriority,
      created_by: row.created_by as string,
      origin_message_id: row.origin_message_id as string | null,
      assignees: assignees.map((a) => a.agent_id),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      completed_at: row.completed_at as string | null,
      cancelled_at: row.cancelled_at as string | null,
    };
  });

  let nextCursor: string | null = null;
  if (hasMore && tasks.length > 0) {
    const last = tasks[tasks.length - 1];
    nextCursor = Buffer.from(JSON.stringify({ updated_at: last.updated_at, id: last.id })).toString('base64');
  }

  return { tasks, next_cursor: nextCursor, has_more: hasMore };
}

export function getTask(
  db: Database.Database,
  agentId: string,
  taskId: string,
): GetTaskResponse {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown> | undefined;
  if (!task) {
    throw new ServerError(ErrorCode.TASK_NOT_FOUND, 'Task not found', false, 404);
  }

  // Must be room member to read
  if (!isRoomMember(db, task.room_id as string, agentId)) {
    throw new ServerError(ErrorCode.NOT_ROOM_MEMBER, 'Not a member of this room', false, 403);
  }

  const assignees = db.prepare(
    'SELECT agent_id FROM task_assignees WHERE task_id = ?',
  ).all(taskId) as { agent_id: string }[];

  const events = db.prepare(
    'SELECT * FROM task_events WHERE task_id = ? ORDER BY created_order ASC',
  ).all(taskId) as Record<string, unknown>[];

  const artifacts = db.prepare(
    'SELECT * FROM task_artifacts WHERE task_id = ? ORDER BY created_at ASC',
  ).all(taskId) as Record<string, unknown>[];

  return {
    task: {
      id: task.id as string,
      room_id: task.room_id as string,
      title: task.title as string,
      description: task.description as string,
      status: task.status as TaskStatus,
      priority: task.priority as TaskPriority,
      created_by: task.created_by as string,
      origin_message_id: task.origin_message_id as string | null,
      assignees: assignees.map((a) => a.agent_id),
      created_at: task.created_at as string,
      updated_at: task.updated_at as string,
      completed_at: task.completed_at as string | null,
      cancelled_at: task.cancelled_at as string | null,
    },
    assignees: assignees.map((a) => a.agent_id),
    events: events.map((e) => ({
      id: e.id as string,
      task_id: e.task_id as string,
      actor_id: e.actor_id as string,
      type: e.type as TaskEventType,
      from_status: (e.from_status as TaskStatus) ?? null,
      to_status: (e.to_status as TaskStatus) ?? null,
      body: (e.body as string) ?? '',
      metadata: JSON.parse((e.metadata as string) ?? '{}'),
      created_at: e.created_at as string,
    })),
    artifacts: artifacts.map((a) => ({
      id: a.id as string,
      task_id: a.task_id as string,
      created_by: a.created_by as string,
      type: a.type as ArtifactType,
      name: a.name as string,
      content: (a.content as string) ?? null,
      uri: (a.uri as string) ?? null,
      mime_type: (a.mime_type as string) ?? '',
      metadata: JSON.parse((a.metadata as string) ?? '{}'),
      created_at: a.created_at as string,
    })),
  };
}

export function appendTaskEvent(
  db: Database.Database,
  agentId: string,
  taskId: string,
  req: AddTaskEventRequest,
): AddTaskEventResponse {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown> | undefined;
  if (!task) {
    throw new ServerError(ErrorCode.TASK_NOT_FOUND, 'Task not found', false, 404);
  }

  // Permission: creator, assignee, or admin
  if (!isTaskParticipant(db, taskId, agentId)) {
    throw new ServerError(ErrorCode.NOT_TASK_CREATOR_OR_ASSIGNEE, 'Must be task creator, assignee, or admin', false, 403);
  }

  // Validate body size (64 KiB)
  if (req.body && Buffer.byteLength(req.body, 'utf-8') > 65_536) {
    throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Event body exceeds 64 KiB limit');
  }

  // Idempotency check
  const requestHash = createHash('sha256').update(JSON.stringify(req)).digest('hex');
  const cached = checkIdempotency(db, agentId, req.idempotency_key, requestHash);
  if (cached !== null) {
    return cached as AddTaskEventResponse;
  }

  const currentStatus = task.status as TaskStatus;
  let eventType: TaskEventType = 'commented';
  let fromStatus: TaskStatus | null = null;
  let toStatus: TaskStatus | null = null;

  if (req.status) {
    // Status transition
    if (TERMINAL_STATUSES.has(currentStatus)) {
      throw new ServerError(ErrorCode.TASK_TERMINAL_STATE, 'Task is in terminal state');
    }
    if (!isValidTransition(currentStatus, req.status)) {
      throw new ServerError(ErrorCode.INVALID_STATUS_TRANSITION, `Cannot transition from ${currentStatus} to ${req.status}`);
    }
    // Only creator or admin can cancel
    if (req.status === 'cancelled') {
      const profile = db.prepare('SELECT is_admin FROM profiles WHERE id = ?').get(agentId) as { is_admin: number } | undefined;
      if (task.created_by !== agentId && profile?.is_admin !== 1) {
        throw new ServerError(ErrorCode.NOT_TASK_CREATOR_OR_ASSIGNEE, 'Only creator or admin can cancel');
      }
    }
    eventType = 'status_changed';
    fromStatus = currentStatus;
    toStatus = req.status;
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  const result = db.transaction(() => {
    const createdOrder = nextCreatedOrder(db);

    db.prepare(`
      INSERT INTO task_events (id, task_id, actor_id, type, from_status, to_status, body, metadata, created_at, created_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      taskId,
      agentId,
      eventType,
      fromStatus,
      toStatus,
      req.body ?? '',
      JSON.stringify(req.metadata ?? {}),
      now,
      createdOrder,
    );

    // Update task status if transition
    if (req.status) {
      const updateFields: string[] = ['status = ?', 'updated_at = ?'];
      const updateParams: unknown[] = [req.status, now];

      if (req.status === 'completed') {
        updateFields.push('completed_at = ?');
        updateParams.push(now);
      } else if (req.status === 'cancelled') {
        updateFields.push('cancelled_at = ?');
        updateParams.push(now);
      }

      updateParams.push(taskId);
      db.prepare(`UPDATE tasks SET ${updateFields.join(', ')} WHERE id = ?`).run(...updateParams);
    }

    const response: AddTaskEventResponse = {
      id,
      task_id: taskId,
      type: eventType,
      from_status: fromStatus,
      to_status: toStatus,
      created_at: now,
    };

    storeIdempotency(db, agentId, req.idempotency_key, requestHash, response);

    return response;
  })();

  return result;
}

export function addTaskArtifact(
  db: Database.Database,
  agentId: string,
  taskId: string,
  req: AddTaskArtifactRequest,
): AddTaskArtifactResponse {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown> | undefined;
  if (!task) {
    throw new ServerError(ErrorCode.TASK_NOT_FOUND, 'Task not found', false, 404);
  }

  // Permission: creator, assignee, or admin
  if (!isTaskParticipant(db, taskId, agentId)) {
    throw new ServerError(ErrorCode.NOT_TASK_CREATOR_OR_ASSIGNEE, 'Must be task creator, assignee, or admin', false, 403);
  }

  // Validate artifact type
  if (!VALID_ARTIFACT_TYPES.has(req.type)) {
    throw new ServerError(ErrorCode.INVALID_ARTIFACT_TYPE, `Invalid artifact type: ${req.type}`);
  }

  // Validate name
  if (!req.name || req.name.length === 0) {
    throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Artifact name is required');
  }

  // Type-specific validation
  if (req.type === 'uri') {
    if (!req.uri) {
      throw new ServerError(ErrorCode.INVALID_ARTIFACT_TYPE, 'URI artifact requires uri field');
    }
    if (req.uri.length > 2048) {
      throw new ServerError(ErrorCode.ARTIFACT_TOO_LARGE, 'URI exceeds 2048 character limit');
    }
    if (req.content) {
      throw new ServerError(ErrorCode.INVALID_ARTIFACT_TYPE, 'URI artifact should not have content');
    }
  } else {
    // text, json, code use content
    if (!req.content) {
      throw new ServerError(ErrorCode.INVALID_ARTIFACT_TYPE, `${req.type} artifact requires content field`);
    }
    if (Buffer.byteLength(req.content, 'utf-8') > 1_048_576) {
      throw new ServerError(ErrorCode.ARTIFACT_TOO_LARGE, 'Artifact content exceeds 1MB limit');
    }
    // JSON validation
    if (req.type === 'json') {
      try {
        JSON.parse(req.content);
      } catch {
        throw new ServerError(ErrorCode.INVALID_ARTIFACT_TYPE, 'JSON artifact content must be valid JSON');
      }
    }
    if (req.uri) {
      throw new ServerError(ErrorCode.INVALID_ARTIFACT_TYPE, `${req.type} artifact should not have uri`);
    }
  }

  // Idempotency check
  const requestHash = createHash('sha256').update(JSON.stringify(req)).digest('hex');
  const cached = checkIdempotency(db, agentId, req.idempotency_key, requestHash);
  if (cached !== null) {
    return cached as AddTaskArtifactResponse;
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  const result = db.transaction(() => {
    db.prepare(`
      INSERT INTO task_artifacts (id, task_id, created_by, type, name, content, uri, mime_type, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      taskId,
      agentId,
      req.type,
      req.name,
      req.content ?? null,
      req.uri ?? null,
      req.mime_type ?? '',
      JSON.stringify(req.metadata ?? {}),
      now,
    );

    // Write artifact_added event
    const eventId = uuidv4();
    const createdOrder = nextCreatedOrder(db);
    db.prepare(`
      INSERT INTO task_events (id, task_id, actor_id, type, body, metadata, created_at, created_order)
      VALUES (?, ?, ?, 'artifact_added', '', ?, ?, ?)
    `).run(eventId, taskId, agentId, JSON.stringify({ artifact_id: id, type: req.type, name: req.name }), now, createdOrder);

    // Update task updated_at
    db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now, taskId);

    const response: AddTaskArtifactResponse = {
      id,
      task_id: taskId,
      type: req.type,
      name: req.name,
      created_by: agentId,
      created_at: now,
    };

    storeIdempotency(db, agentId, req.idempotency_key, requestHash, response);

    return response;
  })();

  return result;
}
