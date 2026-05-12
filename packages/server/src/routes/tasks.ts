import { Router } from 'express';
import type Database from 'better-sqlite3';
import type { TaskStatus } from '@flock/shared';
import { createTask, listTasks, getTask, appendTaskEvent, addTaskArtifact } from '../services/task.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import type { EventBus } from '../sse/event-bus.js';

export function tasksRouter(db: Database.Database, eventBus: EventBus): Router {
  const router = Router();
  const auth = authMiddleware(db);

  // POST /tasks — create task
  router.post('/', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = createTask(db, req.agentId!, req.body);

      eventBus.emitTaskCreated(
        { task_id: result.id, room_id: result.room_id, title: result.title, created_by: result.created_by },
        result.room_id,
        req.agentId!,
      );

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /tasks — list tasks
  router.get('/', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = listTasks(db, req.agentId!, {
        room_id: req.query.room_id as string | undefined,
        status: req.query.status as TaskStatus | undefined,
        assignee_id: req.query.assignee_id as string | undefined,
        created_by: req.query.created_by as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        cursor: req.query.cursor as string | undefined,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /tasks/:id — get task detail
  router.get('/:id', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = getTask(db, req.agentId!, req.params.id as string);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /tasks/:id/events — append task event
  router.post('/:id/events', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = appendTaskEvent(db, req.agentId!, req.params.id as string, req.body);

      if (result.to_status) {
        const task = db.prepare('SELECT room_id FROM tasks WHERE id = ?').get(req.params.id as string) as { room_id: string } | undefined;
        if (task) {
          eventBus.emitTaskStatus(
            {
              task_id: req.params.id as string,
              room_id: task.room_id,
              from_status: result.from_status!,
              to_status: result.to_status,
              actor_id: req.agentId!,
            },
            task.room_id,
            req.agentId!,
          );
        }
      }

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /tasks/:id/artifacts — add artifact
  router.post('/:id/artifacts', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = addTaskArtifact(db, req.agentId!, req.params.id as string, req.body);

      const task = db.prepare('SELECT room_id FROM tasks WHERE id = ?').get(req.params.id as string) as { room_id: string } | undefined;
      if (task) {
        eventBus.emitTaskArtifact(
          {
            task_id: req.params.id as string,
            room_id: task.room_id,
            artifact_id: result.id,
            artifact_type: result.type,
            actor_id: req.agentId!,
          },
          task.room_id,
          req.agentId!,
        );
      }

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
