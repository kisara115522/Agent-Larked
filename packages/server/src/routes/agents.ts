import { Router } from 'express';
import type Database from 'better-sqlite3';
import { registerAgent, updateProfile, searchAgents, getProfile, cleanupStaleOnlineAgents } from '../services/identity.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { humanAuthMiddleware, type HumanAuthenticatedRequest } from '../middleware/human-auth.js';
import { flexAuthMiddleware, type FlexAuthenticatedRequest } from '../middleware/flex-auth.js';
import type { EventBus } from '../sse/event-bus.js';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';
import { notifyRuntimeSpawn, notifyRuntimeStop } from '../services/callback.js';

export function agentsRouter(db: Database.Database, eventBus?: EventBus): Router {
  const router = Router();
  const auth = authMiddleware(db);
  const humanAuth = humanAuthMiddleware(db);
  const flexAuth = flexAuthMiddleware(db);

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
  router.get('/:id', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
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
        res.status(403).json({ error: { code: ErrorCode.FORBIDDEN, message: 'Cannot update another agent', retryable: false } });
        return;
      }

      // Validate name if provided
      if (req.body.name !== undefined) {
        const name = String(req.body.name).trim();
        if (name.length < 1 || name.length > 64) {
          throw new ServerError(ErrorCode.VALIDATION_ERROR, 'name must be 1-64 characters', false, 400);
        }
        if (!/^[\w.-]+$/.test(name)) {
          throw new ServerError(ErrorCode.VALIDATION_ERROR, 'name may only contain letters, digits, dots, hyphens, and underscores', false, 400);
        }
        req.body.name = name;
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
  router.get('/', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
    try {
      // Clean up stale online agents before returning results
      const staleIds = cleanupStaleOnlineAgents(db);
      if (staleIds.length > 0 && eventBus) {
        for (const id of staleIds) {
          eventBus.emitAgentStatus({ agent_id: id, status: 'dormant' });
        }
      }

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

  // --- Human-auth routes (v0.5) ---

  // DELETE /agents/:id — delete agent (human auth)
  router.delete('/:id', humanAuth, (req: HumanAuthenticatedRequest, res, next) => {
    try {
      const agentId = req.params.id as string;
      const existing = db.prepare('SELECT id FROM profiles WHERE id = ?').get(agentId) as { id: string } | undefined;
      if (!existing) {
        throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Agent not found', false, 404);
      }

      db.prepare('DELETE FROM profiles WHERE id = ?').run(agentId);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /agents/:id/spawn — spawn agent (human auth)
  router.post('/:id/spawn', humanAuth, (req: HumanAuthenticatedRequest, res, next) => {
    try {
      const agentId = req.params.id as string;
      const existing = db.prepare('SELECT id, status FROM profiles WHERE id = ?').get(agentId) as { id: string; status: string } | undefined;
      if (!existing) {
        throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Agent not found', false, 404);
      }

      // Create spawn record
      const spawnId = crypto.randomUUID();
      const now = new Date().toISOString();
      let runtimeId = req.body.runtime_id ?? null;
      const prompt = req.body.prompt ?? null;

      // Auto-select an online runtime if none specified
      if (!runtimeId) {
        const runtime = db.prepare(`
          SELECT r.id FROM agent_runtimes r
          WHERE r.status = 'online'
          AND (SELECT COUNT(*) FROM agent_spawns s WHERE s.runtime_id = r.id AND s.status = 'active') < r.max_agents
          ORDER BY r.last_heartbeat_at DESC
          LIMIT 1
        `).get() as { id: string } | undefined;
        if (runtime) {
          runtimeId = runtime.id;
        }
      }

      if (!runtimeId) {
        throw new ServerError(ErrorCode.VALIDATION_ERROR, 'No online runtime available. Start a runtime daemon first.', false, 400);
      }

      db.prepare(`
        INSERT INTO agent_spawns (id, agent_id, runtime_id, status, spawned_at, last_active_at, prompt)
        VALUES (?, ?, ?, 'active', ?, ?, ?)
      `).run(spawnId, agentId, runtimeId, now, now, prompt);

      // Update agent status
      db.prepare("UPDATE profiles SET status = 'active', updated_at = ?, last_active_at = ? WHERE id = ?").run(now, now, agentId);

      if (eventBus) {
        eventBus.emitAgentStatus({ agent_id: agentId, status: 'active' });
      }

      // Notify runtime to actually spawn the agent process
      if (runtimeId) {
        notifyRuntimeSpawn(db, runtimeId, agentId, prompt ?? undefined);
      }

      res.status(201).json({ spawn_id: spawnId, status: 'active' });
    } catch (err) {
      next(err);
    }
  });

  // POST /agents/:id/stop — stop agent (human auth)
  router.post('/:id/stop', humanAuth, (req: HumanAuthenticatedRequest, res, next) => {
    try {
      const agentId = req.params.id as string;
      const existing = db.prepare('SELECT id FROM profiles WHERE id = ?').get(agentId) as { id: string } | undefined;
      if (!existing) {
        throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Agent not found', false, 404);
      }

      const now = new Date().toISOString();

      // Get runtime_id before marking as stopped
      const activeSpawn = db.prepare(
        "SELECT runtime_id FROM agent_spawns WHERE agent_id = ? AND status = 'active' ORDER BY spawned_at DESC LIMIT 1",
      ).get(agentId) as { runtime_id: string | null } | undefined;

      // Mark active spawns as stopped
      db.prepare("UPDATE agent_spawns SET status = 'stopped', last_active_at = ? WHERE agent_id = ? AND status = 'active'").run(now, agentId);

      // Notify runtime to stop the agent process
      if (activeSpawn?.runtime_id) {
        notifyRuntimeStop(db, activeSpawn.runtime_id, agentId);
      }

      // Update agent status
      db.prepare("UPDATE profiles SET status = 'dormant', updated_at = ? WHERE id = ?").run(now, agentId);

      if (eventBus) {
        eventBus.emitAgentStatus({ agent_id: agentId, status: 'dormant' });
      }

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /agents/:id/wake — wake dormant agent (human auth)
  router.post('/:id/wake', humanAuth, (req: HumanAuthenticatedRequest, res, next) => {
    try {
      const agentId = req.params.id as string;
      const existing = db.prepare('SELECT id, status FROM profiles WHERE id = ?').get(agentId) as { id: string; status: string } | undefined;
      if (!existing) {
        throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Agent not found', false, 404);
      }

      const now = new Date().toISOString();
      const prompt = req.body.prompt ?? null;
      let runtimeId = req.body.runtime_id ?? null;

      // Auto-select an online runtime if none specified
      if (!runtimeId) {
        const runtime = db.prepare(`
          SELECT r.id FROM agent_runtimes r
          WHERE r.status = 'online'
          AND (SELECT COUNT(*) FROM agent_spawns s WHERE s.runtime_id = r.id AND s.status = 'active') < r.max_agents
          ORDER BY r.last_heartbeat_at DESC
          LIMIT 1
        `).get() as { id: string } | undefined;
        if (runtime) {
          runtimeId = runtime.id;
        }
      }

      // Create new spawn record for the wake
      const spawnId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO agent_spawns (id, agent_id, runtime_id, status, spawned_at, last_active_at, prompt)
        VALUES (?, ?, ?, 'active', ?, ?, ?)
      `).run(spawnId, agentId, runtimeId, now, now, prompt);

      // Update agent status
      db.prepare("UPDATE profiles SET status = 'active', updated_at = ?, last_active_at = ? WHERE id = ?").run(now, now, agentId);

      if (eventBus) {
        eventBus.emitAgentStatus({ agent_id: agentId, status: 'active' });
      }

      // Notify runtime to wake the agent
      if (runtimeId) {
        notifyRuntimeSpawn(db, runtimeId, agentId, prompt ?? undefined);
      }

      // Log wake event
      db.prepare(`
        INSERT INTO wake_events (id, agent_id, triggered_by, trigger_type, prompt, created_at)
        VALUES (?, ?, ?, 'manual', ?, ?)
      `).run(crypto.randomUUID(), agentId, req.humanId!, prompt, now);

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // GET /agents/:id/status — get agent runtime status
  router.get('/:id/status', humanAuth, (req: HumanAuthenticatedRequest, res, next) => {
    try {
      const agentId = req.params.id as string;
      const profile = db.prepare('SELECT status, last_active_at FROM profiles WHERE id = ?').get(agentId) as { status: string; last_active_at: string | null } | undefined;
      if (!profile) {
        throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Agent not found', false, 404);
      }

      const spawn = db.prepare("SELECT runtime_id, session_id FROM agent_spawns WHERE agent_id = ? AND status = 'active' ORDER BY spawned_at DESC LIMIT 1").get(agentId) as { runtime_id: string | null; session_id: string | null } | undefined;

      res.json({
        status: profile.status,
        runtime_id: spawn?.runtime_id ?? null,
        session_id: spawn?.session_id ?? null,
        last_active_at: profile.last_active_at,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /agents/:id/wake-history — wake event history
  router.get('/:id/wake-history', humanAuth, (req: HumanAuthenticatedRequest, res, next) => {
    try {
      const agentId = req.params.id as string;
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : 50;
      const rows = db.prepare(`
        SELECT w.*, p.display_name AS triggered_by_name
        FROM wake_events w
        LEFT JOIN profiles p ON p.id = w.triggered_by
        WHERE w.agent_id = ?
        ORDER BY w.created_at DESC
        LIMIT ?
      `).all(agentId, limit);
      res.json({ events: rows });
    } catch (err) {
      next(err);
    }
  });

  // GET /agents/:id/activity — agent activity logs (workflow timeline)
  router.get('/:id/activity', humanAuth, (req: HumanAuthenticatedRequest, res, next) => {
    try {
      const agentId = req.params.id as string;
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
      const cursor = req.query.cursor as string | undefined;
      const params: unknown[] = [agentId];
      let where = 'WHERE agent_id = ?';
      if (cursor) {
        where += ' AND created_at < ?';
        params.push(cursor);
      }
      params.push(limit + 1);
      const rows = db.prepare(`
        SELECT * FROM agent_activity_logs ${where} ORDER BY created_at DESC LIMIT ?
      `).all(...params) as Record<string, unknown>[];
      const hasMore = rows.length > limit;
      const logs = rows.slice(0, limit).map(r => ({
        ...r,
        metadata: r.metadata ? JSON.parse(r.metadata as string) : {},
      })) as Record<string, unknown>[];
      res.json({
        logs,
        has_more: hasMore,
        next_cursor: hasMore && logs.length > 0 ? logs[logs.length - 1].created_at : null,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /agents/:id/activity — log agent activity (for Runtime daemon to report)
  router.post('/:id/activity', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const agentId = req.params.id as string;
      const { activity_type, detail, metadata } = req.body;
      if (!activity_type) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'activity_type is required' } });
        return;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO agent_activity_logs (id, agent_id, activity_type, detail, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, agentId, activity_type, detail ?? '', JSON.stringify(metadata ?? {}), now);

      if (eventBus) {
        eventBus.emitWorkflowEvent({ agent_id: agentId, activity_type, detail: detail ?? '', metadata: metadata ?? {}, created_at: now });
      }

      res.status(201).json({ id, agent_id: agentId, activity_type, detail, metadata, created_at: now });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
