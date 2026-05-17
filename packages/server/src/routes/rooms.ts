import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { joinRoom, leaveRoom, listRooms, getRoom, getRoomMembers, requireRoomAccess } from '../services/room.js';
import { getMessages, sendMessage } from '../services/messaging.js';
import { wakeRoomAgents } from '../services/callback.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { humanAuthMiddleware, type HumanAuthenticatedRequest } from '../middleware/human-auth.js';
import { flexAuthMiddleware, type FlexAuthenticatedRequest } from '../middleware/flex-auth.js';
import type { EventBus } from '../sse/event-bus.js';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';

export function roomsRouter(db: Database.Database, eventBus: EventBus): Router {
  const router = Router();
  const auth = authMiddleware(db);
  const humanAuth = humanAuthMiddleware(db);
  const flexAuth = flexAuthMiddleware(db);

  // POST /rooms — create room (any authenticated agent)
  router.post('/', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const id = randomUUID();
      const now = new Date().toISOString();
      const name = String(req.body.name || '').trim();
      if (!name || name.length > 64) {
        throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Room name must be 1-64 characters', false, 400);
      }
      const visibility = req.body.visibility ?? 'public';
      if (visibility !== 'public' && visibility !== 'private') {
        throw new ServerError(ErrorCode.VALIDATION_ERROR, 'visibility must be public or private', false, 400);
      }

      // Check uniqueness
      const dup = db.prepare('SELECT id FROM rooms WHERE name = ?').get(name);
      if (dup) {
        throw new ServerError(ErrorCode.ROOM_ALREADY_EXISTS, `Room '${name}' already exists`, false, 409);
      }

      const agentId = req.agentId!;
      db.prepare(
        'INSERT INTO rooms (id, name, description, visibility, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(id, name, req.body.description ?? '', visibility, agentId, now);

      // Auto-join creator
      db.prepare('INSERT OR IGNORE INTO room_members (room_id, agent_id, joined_at) VALUES (?, ?, ?)').run(id, agentId, now);

      res.status(201).json({
        id,
        name,
        description: req.body.description ?? '',
        visibility,
        created_by: agentId,
        created_at: now,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /rooms — list all rooms (public + private rooms the agent/human is a member of)
  router.get('/', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
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
  router.get('/:id/members', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
    try {
      requireRoomAccess(db, req.params.id as string, req.agentId!);
      const result = getRoomMembers(db, req.params.id as string);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /rooms/:id/join (agent or human)
  router.post('/:id/join', auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = joinRoom(db, req.params.id as string, req.agentId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /rooms/:id/join (human auth)
  router.post('/:id/join/human', humanAuth, (req: HumanAuthenticatedRequest, res, next) => {
    try {
      const result = joinRoom(db, req.params.id as string, req.humanId!);
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

  // GET /rooms/:id/messages — get room messages
  router.get('/:id/messages', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
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

  // POST /rooms/:id/messages — human sends message (triggers broadcast wake)
  router.post('/:id/messages', humanAuth, (req: HumanAuthenticatedRequest, res, next) => {
    try {
      const roomId = req.params.id as string;
      requireRoomAccess(db, roomId, req.humanId!);

      const result = sendMessage(db, req.humanId!, {
        room_id: roomId,
        content: req.body.content,
        idempotency_key: req.body.idempotency_key ?? randomUUID(),
        mentions: req.body.mentions,
        reply_to: req.body.reply_to,
      }, 'human');

      // Broadcast wake: notify all dormant agents in the room
      const human = db.prepare('SELECT display_name FROM humans WHERE id = ?').get(req.humanId!) as { display_name: string } | undefined;
      wakeRoomAgents(db, roomId, req.humanId!, human?.display_name ?? 'Human', req.body.content?.slice(0, 200) ?? '');

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /rooms/:id — room details (must be after /:id/members and /:id/messages)
  router.get('/:id', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
    try {
      requireRoomAccess(db, req.params.id as string, req.agentId!);
      const result = getRoom(db, req.params.id as string);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /rooms/:id/subscribe (accepts both agent and human tokens)
  router.post('/:id/subscribe', flexAuth, (req: FlexAuthenticatedRequest, res) => {
    eventBus.subscribe(req.agentId!, req.params.id as string);
    res.json({ ok: true });
  });

  // POST /rooms/:id/unsubscribe (accepts both agent and human tokens)
  router.post('/:id/unsubscribe', flexAuth, (req: FlexAuthenticatedRequest, res) => {
    eventBus.unsubscribe(req.agentId!, req.params.id as string);
    res.json({ ok: true });
  });

  return router;
}
