import { Router } from 'express';
import type Database from 'better-sqlite3';
import { broadcastMessage, getFeed } from '../services/broadcast.js';
import { getFollowerIds } from '../services/follow.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import type { EventBus } from '../sse/event-bus.js';

export function broadcastRouter(db: Database.Database, eventBus: EventBus): Router {
  const router = Router();
  const auth = authMiddleware(db);

  // POST / — send broadcast message
  router.post('/', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = broadcastMessage(db, req.agentId!, req.body);
      // Notify followers via SSE
      const followerIds = getFollowerIds(db, req.agentId!);
      if (followerIds.length > 0) {
        eventBus.emitBroadcast(
          { room_id: `broadcast-${req.agentId}`, message_id: result.id, from: req.agentId! },
          followerIds,
          req.agentId!,
        );
      }
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function feedRouter(db: Database.Database): Router {
  const router = Router();
  const auth = authMiddleware(db);

  // GET / — get broadcast feed from followed agents
  router.get('/', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const query = {
        limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
        cursor: req.query.cursor !== undefined ? Number(req.query.cursor) : undefined,
      };
      const result = getFeed(db, req.agentId!, query);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
