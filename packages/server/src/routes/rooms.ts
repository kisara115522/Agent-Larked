import { Router } from 'express';
import type Database from 'better-sqlite3';
import { joinRoom, leaveRoom, listRooms, getRoom, getRoomMembers, inviteToRoom, acceptInvite, rejectInvite, requireRoomAccess } from '../services/room.js';
import { getMessages } from '../services/messaging.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { adminAuthMiddleware, type AdminRequest } from '../middleware/admin-auth.js';
import type { EventBus } from '../sse/event-bus.js';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';

export function roomsRouter(db: Database.Database, eventBus: EventBus): Router {
  const router = Router();
  const auth = authMiddleware(db);
  const adminAuth = adminAuthMiddleware(db);

  // POST /rooms — create room (admin-only)
  router.post('/', adminAuth, (req: AdminRequest, res, next) => {
    try {
      const { randomUUID } = require('node:crypto');
      const id = randomUUID();
      const now = new Date().toISOString();
      const name = String(req.body.name || '').trim();
      if (!name || name.length > 64) {
        throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Room name must be 1-64 characters', false, 400);
      }
      const visibility = req.body.visibility ?? 'public';

      // Check uniqueness
      const dup = db.prepare('SELECT id FROM rooms WHERE name = ?').get(name);
      if (dup) {
        throw new ServerError(ErrorCode.ROOM_ALREADY_EXISTS, `Room '${name}' already exists`, false, 409);
      }

      // Admin creates room — use 'system' for created_by
      db.prepare(
        "INSERT INTO rooms (id, name, description, visibility, created_by, created_at) VALUES (?, ?, ?, ?, 'system', ?)",
      ).run(id, name, req.body.description ?? '', visibility, now);

      res.status(201).json({
        id,
        name,
        description: req.body.description ?? '',
        visibility,
        created_by: 'system',
        created_at: now,
      });
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
  router.get('/:id/members', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      requireRoomAccess(db, req.params.id as string, req.agentId!);
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
      requireRoomAccess(db, req.params.id as string, req.agentId!);
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
  router.get('/:id', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      requireRoomAccess(db, req.params.id as string, req.agentId!);
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
