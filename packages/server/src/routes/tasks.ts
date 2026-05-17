import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createTask, getTask, listTasks, updateTask } from '../services/task.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import type { EventBus } from '../sse/event-bus.js';

export function tasksRouter(db: Database.Database, eventBus: EventBus): Router {
  const router = Router();
  const auth = authMiddleware(db);

  // POST /tasks — create task
  router.post('/', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = createTask(db, req.agentId!, req.body);

      // Emit SSE event
      eventBus.emitTaskCreated(
        { task_id: result.id, room_id: result.room_id, title: result.title, created_by: req.agentId! },
        result.room_id,
        req.agentId!,
      );

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /tasks — list tasks (optionally filtered by room)
  router.get('/', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const roomId = req.query.room_id as string | undefined;
      const result = listTasks(db, {
        room_id: roomId,
        status: req.query.status as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        cursor: req.query.cursor as string | undefined,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /tasks/:id — get single task
  router.get('/:id', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = getTask(db, req.params.id as string);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /tasks/:id/events — get task events (timeline)
  router.get('/:id/events', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const taskId = req.params.id as string;
      // Verify task exists
      const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
      if (!task) {
        res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } });
        return;
      }

      const rows = db.prepare(`
        SELECT te.*, p.display_name AS actor_name
        FROM task_events te
        LEFT JOIN profiles p ON p.id = te.actor_id
        WHERE te.task_id = ?
        ORDER BY te.created_at ASC
      `).all(taskId) as Record<string, unknown>[];

      const events = rows.map(r => ({
        id: r.id,
        task_id: r.task_id,
        event_type: r.event_type,
        actor_id: r.actor_id,
        actor_name: r.actor_name ?? null,
        payload: r.payload ? JSON.parse(r.payload as string) : null,
        created_at: r.created_at,
      }));

      res.json({ events });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /tasks/:id — update task status/assignment
  router.patch('/:id', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const taskId = req.params.id as string;
      const oldStatus = req.body.status ? getTask(db, taskId).status : undefined;
      const result = updateTask(db, taskId, req.agentId!, req.body);

      // Emit SSE event for status change
      if (req.body.status && oldStatus) {
        eventBus.emitTaskStatus(
          { task_id: result.id, room_id: result.room_id, from_status: oldStatus, to_status: result.status, actor_id: req.agentId! },
          result.room_id,
          req.agentId!,
        );
      }

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
