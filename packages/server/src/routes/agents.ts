import { Router } from 'express';
import type Database from 'better-sqlite3';
import { registerAgent, updateProfile, searchAgents } from '../services/identity.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';

export function agentsRouter(db: Database.Database): Router {
  const router = Router();
  const auth = authMiddleware(db);

  // POST /agents — register (no auth required)
  router.post('/', (req, res, next) => {
    try {
      const result = registerAgent(db, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /agents/:id — update profile
  router.patch('/:id', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      if (req.params.id !== req.agentId) {
        res.status(403).json({ error: { code: 0, message: 'Cannot update another agent', retryable: false } });
        return;
      }
      const result = updateProfile(db, req.params.id, req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /agents — search/discover
  router.get('/', auth, (req, res, next) => {
    try {
      const result = searchAgents(db, {
        q: req.query.q as string | undefined,
        capabilities: req.query.capabilities as string | undefined,
        status: req.query.status as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        cursor: req.query.cursor as string | undefined,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
