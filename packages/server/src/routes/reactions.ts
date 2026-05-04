import { Router } from 'express';
import type Database from 'better-sqlite3';
import { addReaction } from '../services/messaging.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import type { EventBus } from '../sse/event-bus.js';

export function reactionsRouter(
  db: Database.Database,
  eventBus: EventBus,
): Router {
  const router = Router();
  const auth = authMiddleware(db);

  // POST /messages/:id/reactions
  router.post('/:id/reactions', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = addReaction(db, req.agentId!, req.params.id as string, req.body);

      // Emit reaction event to message author
      const msg = db.prepare('SELECT from_agent FROM messages WHERE id = ?').get(req.params.id) as { from_agent: string } | undefined;
      if (msg) {
        eventBus.emitReaction(
          { message_id: result.message_id, agent_id: req.agentId!, type: result.type },
          msg.from_agent,
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
