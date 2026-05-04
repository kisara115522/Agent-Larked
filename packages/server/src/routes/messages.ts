import { Router } from 'express';
import type Database from 'better-sqlite3';
import { sendMessage, getThread } from '../services/messaging.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import type { EventBus } from '../sse/event-bus.js';

export function messagesRouter(db: Database.Database, eventBus: EventBus): Router {
  const router = Router();
  const auth = authMiddleware(db);

  // POST /messages — send message
  router.post('/', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = sendMessage(db, req.agentId!, req.body);

      // Emit mention events
      if (req.body.mentions && req.body.mentions.length > 0) {
        eventBus.emitMention(
          {
            message_id: result.id,
            from: req.agentId!,
            content: req.body.content,
            room_id: req.body.room_id,
            sequence: result.sequence,
          },
          req.body.mentions,
          req.agentId!,
        );
      }

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /messages/:id/thread — get thread
  router.get('/:id/thread', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = getThread(db, req.params.id as string);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
