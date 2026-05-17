import { Router } from 'express';
import type Database from 'better-sqlite3';
import { getDirectMessages, listDirectChats, sendDirectMessage } from '../services/direct-chat.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import type { EventBus } from '../sse/event-bus.js';

export function directChatsRouter(db: Database.Database, eventBus: EventBus): Router {
  const router = Router();
  const auth = authMiddleware(db);

  router.get('/', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      res.json(listDirectChats(db, req.agentId!));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:agentId/messages', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      res.json(getDirectMessages(db, req.agentId!, req.params.agentId as string, {
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        cursor: req.query.cursor ? Number(req.query.cursor) : undefined,
      }));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:agentId/messages', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = sendDirectMessage(db, req.agentId!, req.params.agentId as string, req.body);
      eventBus.emitDirectMessage(
        {
          message_id: result.id,
          from: req.agentId!,
          to: req.params.agentId as string,
          content: req.body.content,
          sequence: result.sequence,
        },
        req.params.agentId as string,
        req.agentId!,
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
