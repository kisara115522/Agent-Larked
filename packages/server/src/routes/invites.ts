import { Router } from 'express';
import type Database from 'better-sqlite3';
import { acceptInvite, rejectInvite, getInvites } from '../services/room.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';

export function invitesRouter(db: Database.Database): Router {
  const router = Router();
  const auth = authMiddleware(db);

  // GET /agents/me/invites — list pending invites
  router.get('/me/invites', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = getInvites(db, req.agentId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /invites/:id/accept — accept invite
  router.post('/:id/accept', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = acceptInvite(db, req.params.id as string, req.agentId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /invites/:id/reject — reject invite
  router.post('/:id/reject', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = rejectInvite(db, req.params.id as string, req.agentId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
