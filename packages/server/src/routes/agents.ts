import { Router } from 'express';
import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { registerAgent, updateProfile, searchAgents, getProfile } from '../services/identity.js';
import { authMiddleware, type AuthenticatedRequest, hashToken } from '../middleware/auth.js';
import type { EventBus } from '../sse/event-bus.js';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';
import type { BatchDeleteRequest, BatchDeleteResult, RegenerateTokenResponse } from '@flock/shared';

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

  // POST /agents/:id/token — regenerate token
  router.post('/:id/token', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      if (req.params.id !== req.agentId) {
        res.status(403).json({ error: { code: 0, message: 'Cannot regenerate token for another agent', retryable: false } });
        return;
      }

      const existing = db.prepare('SELECT id FROM profiles WHERE id = ?').get(req.params.id) as { id: string } | undefined;
      if (!existing) {
        throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Agent not found', false, 404);
      }

      const newToken = randomBytes(32).toString('hex');
      const newHash = hashToken(newToken);
      const now = new Date().toISOString();

      db.prepare('UPDATE profiles SET token_hash = ?, updated_at = ? WHERE id = ?').run(newHash, now, req.params.id);

      const response: RegenerateTokenResponse = { id: req.params.id, token: newToken };
      res.json(response);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /agents/:id — delete agent
  router.delete('/:id', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      if (req.params.id !== req.agentId) {
        res.status(403).json({ error: { code: 0, message: 'Cannot delete another agent', retryable: false } });
        return;
      }

      const existing = db.prepare('SELECT id FROM profiles WHERE id = ?').get(req.params.id) as { id: string } | undefined;
      if (!existing) {
        throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Agent not found', false, 404);
      }

      // Clean up related data
      db.prepare('DELETE FROM reactions WHERE agent_id = ?').run(req.params.id);
      db.prepare('DELETE FROM message_mentions WHERE agent_id = ?').run(req.params.id);
      db.prepare('DELETE FROM room_members WHERE agent_id = ?').run(req.params.id);
      db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').run(req.params.id, req.params.id);
      db.prepare('DELETE FROM invites WHERE inviter_id = ? OR invitee_id = ?').run(req.params.id, req.params.id);
      // Messages: keep as history but set from to deleted marker
      db.prepare("UPDATE messages SET from_agent = '[deleted]' WHERE from_agent = ?").run(req.params.id);
      db.prepare('DELETE FROM profiles WHERE id = ?').run(req.params.id);

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /agents/batch-delete — batch delete agents
  router.post('/batch-delete', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const { agent_ids } = req.body as BatchDeleteRequest;

      if (!Array.isArray(agent_ids) || agent_ids.length === 0) {
        throw new ServerError(ErrorCode.VALIDATION_ERROR, 'agent_ids must be a non-empty array', false, 400);
      }

      // Can only delete yourself (same auth rule as single delete)
      const results: BatchDeleteResult[] = [];

      for (const agentId of agent_ids) {
        try {
          if (agentId !== req.agentId) {
            results.push({ id: agentId, success: false, error: 'Cannot delete another agent' });
            continue;
          }

          const existing = db.prepare('SELECT id FROM profiles WHERE id = ?').get(agentId) as { id: string } | undefined;
          if (!existing) {
            results.push({ id: agentId, success: false, error: 'Agent not found' });
            continue;
          }

          db.prepare('DELETE FROM reactions WHERE agent_id = ?').run(agentId);
          db.prepare('DELETE FROM message_mentions WHERE agent_id = ?').run(agentId);
          db.prepare('DELETE FROM room_members WHERE agent_id = ?').run(agentId);
          db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').run(agentId, agentId);
          db.prepare('DELETE FROM invites WHERE inviter_id = ? OR invitee_id = ?').run(agentId, agentId);
          db.prepare("UPDATE messages SET from_agent = '[deleted]' WHERE from_agent = ?").run(agentId);
          db.prepare('DELETE FROM profiles WHERE id = ?').run(agentId);

          results.push({ id: agentId, success: true });
        } catch (err) {
          results.push({ id: agentId, success: false, error: (err as Error).message });
        }
      }

      res.json({ results });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
