import { Router } from 'express';
import type Database from 'better-sqlite3';
import { sendMessage, getThread } from '../services/messaging.js';
import { wakeMentionedAgents } from '../services/callback.js';
import { markRoomPendingForAgents } from '../services/room-context.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { flexAuthMiddleware, type FlexAuthenticatedRequest } from '../middleware/flex-auth.js';
import type { EventBus } from '../sse/event-bus.js';

export function messagesRouter(db: Database.Database, eventBus: EventBus): Router {
  const router = Router();
  const auth = authMiddleware(db);
  const flexAuth = flexAuthMiddleware(db);

  // POST /messages — send message
  router.post('/', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
    try {
      const result = sendMessage(db, req.agentId!, req.body);
      markRoomPendingForAgents(db, req.body.room_id, result.sequence, req.agentId!);

      // Emit mention events via SSE
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

        // Wake dormant mentioned agents via runtime callback
        const senderProfile = db.prepare('SELECT name FROM profiles WHERE id = ?').get(req.agentId!) as { name: string } | undefined;
        wakeMentionedAgents(
          db,
          req.body.mentions,
          req.body.room_id,
          result.id,
          senderProfile?.name ?? '',
          req.body.content.slice(0, 200),
        );
      }

      // room_message SSE events are now handled by DB poller (cross-process bridge)

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /messages/:id/thread — get thread
  router.get('/:id/thread', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
    try {
      const result = getThread(db, req.params.id as string);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
