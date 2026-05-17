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
