import { Router } from 'express';
import type Database from 'better-sqlite3';
import { registerRuntime, listRuntimes, heartbeat } from '../services/runtime.js';
import { flexAuthMiddleware, type FlexAuthenticatedRequest } from '../middleware/flex-auth.js';

export function runtimesRouter(db: Database.Database): Router {
  const router = Router();
  const flexAuth = flexAuthMiddleware(db);

  // POST /runtimes — register a new runtime (no auth — runtime is infrastructure, not agent)
  router.post('/', (req, res, next) => {
    try {
      const result = registerRuntime(db, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /runtimes — list all registered runtimes
  router.get('/', flexAuth, (_req: FlexAuthenticatedRequest, res, next) => {
    try {
      const result = listRuntimes(db);
      res.json({ runtimes: result });
    } catch (err) {
      next(err);
    }
  });

  // POST /runtimes/:id/heartbeat — update runtime heartbeat (no auth — runtime uses its own id)
  router.post('/:id/heartbeat', (req, res, next) => {
    try {
      const result = heartbeat(db, req.params.id as string);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
