import { Router } from 'express';
import type Database from 'better-sqlite3';
import { registerAgent, updateProfile, searchAgents, getProfile } from '../services/identity.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import type { EventBus } from '../sse/event-bus.js';

export function agentsRouter(db: Database.Database, eventBus?: EventBus): Router {
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

  // GET /agents/me — current agent profile
  router.get('/me', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = getProfile(db, req.agentId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /agents/:id — get agent by ID
  router.get('/:id', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = getProfile(db, req.params.id as string);
      res.json(result);
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
      // Broadcast status change via SSE
      if (req.body.status && eventBus) {
        eventBus.emitAgentStatus({ agent_id: result.id, status: result.status });
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /agents — search/discover
  router.get('/', auth, (req, res, next) => {
    try {
      const rawLimit = req.query.limit ? Number(req.query.limit) : undefined;
      const limit = rawLimit !== undefined && Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
      const result = searchAgents(db, {
        q: req.query.q as string | undefined,
        capabilities: req.query.capabilities as string | undefined,
        status: req.query.status as string | undefined,
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
