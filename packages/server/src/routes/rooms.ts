import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createRoom, joinRoom, leaveRoom } from '../services/room.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';

export function roomsRouter(db: Database.Database): Router {
  const router = Router();
  const auth = authMiddleware(db);

  // POST /rooms — create room
  router.post('/', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = createRoom(db, req.agentId!, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /rooms/:id/join
  router.post('/:id/join', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = joinRoom(db, req.params.id as string, req.agentId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /rooms/:id/leave
  router.post('/:id/leave', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = leaveRoom(db, req.params.id as string, req.agentId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
