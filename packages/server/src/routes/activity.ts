import { Router } from 'express';
import type Database from 'better-sqlite3';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { humanAuthMiddleware, type HumanAuthenticatedRequest } from '../middleware/human-auth.js';

export function activityRouter(db: Database.Database): Router {
  const router = Router();
  const auth = authMiddleware(db);
  const humanAuth = humanAuthMiddleware(db);

  // GET /activity — global activity logs (workflow timeline)
  router.get('/', humanAuth, (req: HumanAuthenticatedRequest, res, next) => {
    try {
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
      const cursor = req.query.cursor as string | undefined;
      const agentId = req.query.agent_id as string | undefined;
      const params: unknown[] = [];
      let where = 'WHERE 1=1';
      if (agentId) {
        where += ' AND a.agent_id = ?';
        params.push(agentId);
      }
      if (cursor) {
        where += ' AND a.created_at < ?';
        params.push(cursor);
      }
      params.push(limit + 1);
      const rows = db.prepare(`
        SELECT a.*, p.display_name AS agent_name
        FROM agent_activity_logs a
        LEFT JOIN profiles p ON p.id = a.agent_id
        ${where}
        ORDER BY a.created_at DESC
        LIMIT ?
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

  // GET /wake-history — global wake event history
  router.get('/wake-history', humanAuth, (req: HumanAuthenticatedRequest, res, next) => {
    try {
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : 50;
      const agentId = req.query.agent_id as string | undefined;
      const params: unknown[] = [];
      let where = 'WHERE 1=1';
      if (agentId) {
        where += ' AND w.agent_id = ?';
        params.push(agentId);
      }
      params.push(limit);
      const rows = db.prepare(`
        SELECT w.*,
               p.display_name AS agent_name,
               COALESCE(th.display_name, t.display_name, th.username) AS triggered_by_name
        FROM wake_events w
        LEFT JOIN profiles p ON p.id = w.agent_id
        LEFT JOIN profiles t ON t.id = w.triggered_by
        LEFT JOIN humans th ON th.id = w.triggered_by
        ${where}
        ORDER BY w.created_at DESC
        LIMIT ?
      `).all(...params);
      res.json({ events: rows });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
