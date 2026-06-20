import { Router } from 'express';
import type Database from 'better-sqlite3';
import { getDirectMessages, listDirectChats, sendDirectMessage } from '../services/direct-chat.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { flexAuthMiddleware, type FlexAuthenticatedRequest } from '../middleware/flex-auth.js';
import type { EventBus } from '../sse/event-bus.js';
import { wakeDirectMessageAgent } from '../services/callback.js';

export function directChatsRouter(db: Database.Database, eventBus: EventBus): Router {
  const router = Router();
  const auth = authMiddleware(db);
  const flexAuth = flexAuthMiddleware(db);

  router.get('/', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
    try {
      res.json(listDirectChats(db, req.agentId!));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:agentId/messages', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
    try {
      res.json(getDirectMessages(db, req.agentId!, req.params.agentId as string, {
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        cursor: req.query.cursor ? Number(req.query.cursor) : undefined,
      }));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:agentId/messages', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
    try {
      const result = sendDirectMessage(db, req.agentId!, req.params.agentId as string, req.body);
      const sender = db.prepare('SELECT name, display_name FROM profiles WHERE id = ?').get(req.agentId!) as { name: string; display_name: string | null } | undefined;
      wakeDirectMessageAgent(
        db,
        req.params.agentId as string,
        sender?.display_name || sender?.name || req.agentId!,
        String(req.body.content ?? '').slice(0, 200),
        eventBus,
        req.agentId,
      );
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
