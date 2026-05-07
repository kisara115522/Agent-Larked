import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createRoom, joinRoom, leaveRoom, listRooms, getRoom, getRoomMembers, inviteToRoom, acceptInvite, rejectInvite } from '../services/room.js';
import { getMessages } from '../services/messaging.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import type { EventBus } from '../sse/event-bus.js';

export function roomsRouter(db: Database.Database, eventBus: EventBus): Router {
  const router = Router();
  const auth = authMiddleware(db);

  // POST /rooms — create room
  router.post('/', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = createRoom(db, req.agentId!, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /rooms — list all rooms (public + private rooms the agent is a member of)
  router.get('/', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const rawLimit = req.query.limit ? Number(req.query.limit) : undefined;
      const limit = rawLimit !== undefined && Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
      const result = listRooms(db, {
        limit,
        cursor: req.query.cursor as string | undefined,
        agentId: req.agentId,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /rooms/:id/members — list room members
  router.get('/:id/members', auth, (req, res, next) => {
    try {
      const result = getRoomMembers(db, req.params.id as string);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /rooms/:id/join
  router.post('/:id/join', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = joinRoom(db, req.params.id as string, req.agentId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /rooms/:id/leave
  router.post('/:id/leave', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = leaveRoom(db, req.params.id as string, req.agentId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /rooms/:id/invite — invite agent to private room
  router.post('/:id/invite', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const { invitee_id } = req.body as { invitee_id: string };
      const result = inviteToRoom(db, req.params.id as string, req.agentId!, invitee_id);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /rooms/:id/invites — alternative path for invite (alias)
  router.post('/:id/invites', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const { invitee_id } = req.body as { invitee_id: string };
      const result = inviteToRoom(db, req.params.id as string, req.agentId!, invitee_id);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /rooms/:id/messages — get room messages
  router.get('/:id/messages', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const rawLimit = req.query.limit ? Number(req.query.limit) : undefined;
      const limit = rawLimit !== undefined && Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
      const result = getMessages(db, req.params.id as string, {
        limit,
        cursor: req.query.cursor ? Number(req.query.cursor) : undefined,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /rooms/:id — room details (must be after /:id/members and /:id/messages)
  router.get('/:id', auth, (req, res, next) => {
    try {
      const result = getRoom(db, req.params.id as string);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /rooms/:id/subscribe
  router.post('/:id/subscribe', auth, (req: AuthenticatedRequest, res) => {
    eventBus.subscribe(req.agentId!, req.params.id as string);
    res.json({ ok: true });
  });

  // POST /rooms/:id/unsubscribe
  router.post('/:id/unsubscribe', auth, (req: AuthenticatedRequest, res) => {
    eventBus.unsubscribe(req.agentId!, req.params.id as string);
    res.json({ ok: true });
  });

  return router;
}
