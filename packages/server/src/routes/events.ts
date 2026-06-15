import { Router } from 'express';
import type Database from 'better-sqlite3';
import type { EventBus } from '../sse/event-bus.js';
import { flexAuthMiddleware, type FlexAuthenticatedRequest } from '../middleware/flex-auth.js';

export function eventsRouter(db: Database.Database, eventBus: EventBus): Router {
  const router = Router();
  const flexAuth = flexAuthMiddleware(db);

  // GET /events — SSE stream (token via query param or Bearer header)
  router.get('/', flexAuth, (req: FlexAuthenticatedRequest, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.flushHeaders();
    res.write(': connected\n\n');

    if (req.humanId) {
      // Human session: track under humanId so events are delivered to the correct namespace
      eventBus.addHumanClient(req.humanId, res);
    } else if (req.agentId) {
      eventBus.addClient(req.agentId, res);
    }
  });

  return router;
}
