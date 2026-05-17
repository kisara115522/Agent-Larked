import { Router } from 'express';
import type Database from 'better-sqlite3';
import { ErrorCode, createError } from '@flock/shared';
import type { EventBus } from '../sse/event-bus.js';
import { flexAuthMiddleware, type FlexAuthenticatedRequest } from '../middleware/flex-auth.js';

export function eventsRouter(db: Database.Database, eventBus: EventBus): Router {
  const router = Router();
  const flexAuth = flexAuthMiddleware(db);

  // GET /events — SSE stream (token via query param or Bearer header)
  router.get('/', flexAuth, (req: FlexAuthenticatedRequest, res) => {
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.flushHeaders();

    // Send initial comment to establish connection
    res.write(': connected\n\n');

    eventBus.addClient(req.agentId!, res);
  });

  return router;
}
