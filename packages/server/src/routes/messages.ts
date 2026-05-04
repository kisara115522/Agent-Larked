import { Router } from 'express';
import type Database from 'better-sqlite3';
import { sendMessage, getMessages, getThread } from '../services/messaging.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';

export function messagesRouter(db: Database.Database, eventBus: { emitMention: (event: unknown, mentionedAgentIds: string[], senderId: string) => void }): Router {
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

  // GET /rooms/:roomId/messages — get room messages
  router.get('/rooms/:roomId/messages', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = getMessages(db, req.params.roomId as string, {
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        cursor: req.query.cursor ? Number(req.query.cursor) : undefined,
      });
      res.json(result);
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
