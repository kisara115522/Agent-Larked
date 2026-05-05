import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { ErrorCode, createError } from '@flock/shared';
import type { EventBus } from '../sse/event-bus.js';

export function eventsRouter(db: Database.Database, eventBus: EventBus): Router {
  const router = Router();

  // GET /events — SSE stream (token via query param)
  router.get('/', (req, res) => {
    const token = req.query.token as string | undefined;
    if (!token) {
      res.status(401).json({ error: createError(ErrorCode.INVALID_TOKEN) });
      return;
    }

    const hash = createHash('sha256').update(token).digest('hex');
    const row = db.prepare('SELECT id FROM profiles WHERE token_hash = ?').get(hash) as { id: string } | undefined;

    if (!row) {
      res.status(401).json({ error: createError(ErrorCode.INVALID_TOKEN) });
      return;
    }

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.flushHeaders();

    // Send initial comment to establish connection
    res.write(': connected\n\n');

    eventBus.addClient(row.id, res);
  });

  return router;
}
