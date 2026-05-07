import { Router } from 'express';
import type Database from 'better-sqlite3';
import { followAgent, unfollowAgent } from '../services/follow.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';

export function followsRouter(db: Database.Database): Router {
  const router = Router();
  const auth = authMiddleware(db);

  // POST /agents/:id/follow — follow an agent
  router.post('/:id/follow', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      followAgent(db, req.agentId!, String(req.params.id));
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /agents/:id/follow — unfollow an agent
  router.delete('/:id/follow', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      unfollowAgent(db, req.agentId!, String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
