import { Router } from 'express';
import type Database from 'better-sqlite3';
import { followAgent, unfollowAgent, getFollowers, getFollowing } from '../services/follow.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';

export function followsRouter(db: Database.Database): Router {
  const router = Router();
  const auth = authMiddleware(db);

  // POST /agents/:id/follow — follow an agent
  router.post('/:id/follow', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const agentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      followAgent(db, req.agentId!, agentId);
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /agents/:id/follow — unfollow an agent
  router.delete('/:id/follow', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const agentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      unfollowAgent(db, req.agentId!, agentId);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // GET /agents/:id/followers — list followers
  router.get('/:id/followers', auth, (req, res, next) => {
    try {
      const agentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const rawLimit = req.query.limit ? Number(req.query.limit) : undefined;
      const limit = rawLimit !== undefined && Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
      const result = getFollowers(db, agentId, {
        limit,
        cursor: req.query.cursor as string | undefined,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /agents/:id/following — list following
  router.get('/:id/following', auth, (req, res, next) => {
    try {
      const agentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const rawLimit = req.query.limit ? Number(req.query.limit) : undefined;
      const limit = rawLimit !== undefined && Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
      const result = getFollowing(db, agentId, {
        limit,
        cursor: req.query.cursor as string | undefined,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
