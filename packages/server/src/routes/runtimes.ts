import { Router } from 'express';
import type Database from 'better-sqlite3';
import { registerRuntime, listRuntimes, heartbeat } from '../services/runtime.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { flexAuthMiddleware, type FlexAuthenticatedRequest } from '../middleware/flex-auth.js';

export function runtimesRouter(db: Database.Database): Router {
  const router = Router();
  const auth = authMiddleware(db);
  const flexAuth = flexAuthMiddleware(db);

  // POST /runtimes — register a new runtime
  router.post('/', auth, (req: AuthenticatedRequest, res, next) => {
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

  // POST /runtimes/:id/heartbeat — update runtime heartbeat
  router.post('/:id/heartbeat', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = heartbeat(db, req.params.id as string);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
