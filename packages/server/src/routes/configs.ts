import { Router } from 'express';
import type Database from 'better-sqlite3';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { humanAuthMiddleware, type HumanAuthenticatedRequest } from '../middleware/human-auth.js';
import { flexAuthMiddleware, type FlexAuthenticatedRequest } from '../middleware/flex-auth.js';

export function configsRouter(db: Database.Database): Router {
  const router = Router();
  const auth = authMiddleware(db);
  const humanAuth = humanAuthMiddleware(db);
  const flexAuth = flexAuthMiddleware(db);

  // GET /token-budgets — get token budget for an agent
  router.get('/token-budgets', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
    try {
      const agentId = req.query.agent_id as string || req.agentId!;
      const row = db.prepare(
        'SELECT * FROM token_budgets WHERE agent_id = ?',
      ).get(agentId) as Record<string, unknown> | undefined;

      if (!row) {
        res.json({
          agent_id: agentId,
          daily_limit: 100000,
          monthly_limit: 3000000,
          current_daily: 0,
          current_monthly: 0,
          last_reset_at: null,
        });
        return;
      }

      res.json({
        agent_id: row.agent_id,
        daily_limit: row.daily_limit,
        monthly_limit: row.monthly_limit,
        current_daily: row.current_daily,
        current_monthly: row.current_monthly,
        last_reset_at: row.last_reset_at,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /token-usage — get token usage for an agent
  router.get('/token-usage', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
    try {
      const agentId = req.query.agent_id as string || req.agentId!;
      const limit = Math.min(Number(req.query.limit) || 50, 200);

      const rows = db.prepare(
        'SELECT * FROM token_usage WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?',
      ).all(agentId, limit) as Record<string, unknown>[];

      res.json({
        usage: rows.map((r) => ({
          id: r.id,
          agent_id: r.agent_id,
          task_id: r.task_id,
          input_tokens: r.input_tokens,
          output_tokens: r.output_tokens,
          cost_usd: r.cost_usd,
          created_at: r.created_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /configs — get agent configs
  router.get('/configs', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
    try {
      const agentId = req.agentId!;
      const rows = db.prepare(
        'SELECT config_type, config_value, is_global FROM agent_configs WHERE agent_id = ?',
      ).all(agentId) as Record<string, unknown>[];

      // Also include global configs
      const globalRows = db.prepare(
        'SELECT config_type, config_value FROM global_configs',
      ).all() as Record<string, unknown>[];

      res.json({
        agent_configs: rows.map((r) => ({
          config_type: r.config_type,
          config_value: JSON.parse(r.config_value as string),
          is_global: Boolean(r.is_global),
        })),
        global_configs: globalRows.map((r) => ({
          config_type: r.config_type,
          config_value: JSON.parse(r.config_value as string),
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /configs — update agent config
  router.patch('/configs', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
    try {
      const agentId = req.agentId!;
      const { config_type, config_value } = req.body;

      if (!config_type) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'config_type is required' } });
        return;
      }

      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO agent_configs (agent_id, config_type, config_value, is_global, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?)
        ON CONFLICT(agent_id, config_type) DO UPDATE SET config_value = ?, updated_at = ?
      `).run(agentId, config_type, JSON.stringify(config_value), now, now, JSON.stringify(config_value), now);

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
