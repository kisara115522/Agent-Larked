import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createTask, getTask, listTasks, updateTask, createArtifact, listArtifacts } from '../services/task.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { flexAuthMiddleware, type FlexAuthenticatedRequest } from '../middleware/flex-auth.js';
import type { EventBus } from '../sse/event-bus.js';
import { notifyTaskAssignment } from '../services/callback.js';

export function tasksRouter(db: Database.Database, eventBus: EventBus): Router {
  const router = Router();
  const auth = authMiddleware(db);
  const flexAuth = flexAuthMiddleware(db);

  // POST /tasks — create task
  router.post('/', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
    try {
      const result = createTask(db, req.agentId!, req.body);

      // Notify assigned agent
      if (result.assigned_to) {
        notifyTaskAssignment(db, result.assigned_to, result.id, result.title, result.room_id);
      }

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
  router.get('/', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
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
  router.get('/:id', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
    try {
      const result = getTask(db, req.params.id as string);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /tasks/:id/events — get task events (timeline)
  router.get('/:id/events', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
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
  router.patch('/:id', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
    try {
      const taskId = req.params.id as string;
      const oldTask = getTask(db, taskId);
      const oldStatus = req.body.status ? oldTask.status : undefined;
      const result = updateTask(db, taskId, req.agentId!, req.body);

      // Notify newly assigned agent
      if (req.body.assigned_to && req.body.assigned_to !== oldTask.assigned_to) {
        notifyTaskAssignment(db, req.body.assigned_to, result.id, result.title, result.room_id);
      }

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

  // POST /tasks/:id/artifacts — create artifact for a task
  router.post('/:id/artifacts', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
    try {
      const taskId = req.params.id as string;
      const artifact = createArtifact(db, taskId, {
        agent_id: req.agentId!,
        name: req.body.name,
        path: req.body.path,
        content_type: req.body.content_type,
        size: req.body.size,
      });

      // Emit SSE event
      const task = db.prepare('SELECT room_id FROM tasks WHERE id = ?').get(taskId) as { room_id: string } | undefined;
      if (task) {
        eventBus.emitTaskArtifact(
          { task_id: taskId, room_id: task.room_id, artifact_id: artifact.id, artifact_name: artifact.name, actor_id: req.agentId! },
          task.room_id,
          req.agentId!,
        );
      }

      res.status(201).json(artifact);
    } catch (err) {
      next(err);
    }
  });

  // GET /tasks/:id/artifacts — list artifacts for a task
  router.get('/:id/artifacts', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
    try {
      const artifacts = listArtifacts(db, req.params.id as string);
      res.json({ artifacts });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
