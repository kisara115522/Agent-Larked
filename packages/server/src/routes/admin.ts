import { Router } from 'express';
import type Database from 'better-sqlite3';
import { adminAuthMiddleware, type AdminRequest } from '../middleware/admin-auth.js';
import {
  createHumanUser,
  authenticateHumanUser,
  getHumanUser,
  listHumanUsers,
  deleteHumanUser,
  regenerateHumanUserToken,
} from '../services/human-user.js';
import { registerAgent, updateProfile, getProfile, searchAgents } from '../services/identity.js';
import { getRoom } from '../services/room.js';
import { hashToken } from '../middleware/auth.js';
import type { EventBus } from '../sse/event-bus.js';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';
import { deleteAgentCascade, deleteRoomCascade } from '../services/cleanup.js';

export function adminRouter(db: Database.Database, eventBus?: EventBus): Router {
  const router = Router();
  const adminAuth = adminAuthMiddleware(db);

  // POST /admin/login — human admin login
  router.post('/login', (req, res, next) => {
    try {
      const { username, token } = req.body as { username?: string; token?: string };
      if (!username || !token) {
        throw new ServerError(ErrorCode.VALIDATION_ERROR, 'username and token are required', false, 400);
      }
      const user = authenticateHumanUser(db, { username, token });
      res.json({ ok: true, user });
    } catch (err) {
      next(err);
    }
  });

  // GET /admin/me — current admin profile
  router.get('/me', adminAuth, (req: AdminRequest, res, next) => {
    try {
      const user = getHumanUser(db, req.adminUserId!);
      res.json(user);
    } catch (err) {
      next(err);
    }
  });

  // --- Agent Management (admin-only) ---

  // GET /admin/agents — list all agents with management details
  router.get('/agents', adminAuth, (req, res, next) => {
    try {
      const rawLimit = req.query.limit ? Number(req.query.limit) : undefined;
      const limit = rawLimit !== undefined && Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
      const result = searchAgents(db, {
        q: req.query.q as string | undefined,
        capabilities: req.query.capabilities as string | undefined,
        status: req.query.status as string | undefined,
        limit,
        cursor: req.query.cursor as string | undefined,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /admin/agents — create agent (admin-only)
  router.post('/agents', adminAuth, (req: AdminRequest, res, next) => {
    try {
      const result = registerAgent(db, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /admin/agents/:id — update agent (admin-only)
  router.patch('/agents/:id', adminAuth, (req: AdminRequest, res, next) => {
    try {
      // Validate name if provided
      if (req.body.name !== undefined) {
        const name = String(req.body.name).trim();
        if (name.length < 1 || name.length > 64) {
          throw new ServerError(ErrorCode.VALIDATION_ERROR, 'name must be 1-64 characters', false, 400);
        }
        if (!/^[\w.-]+$/.test(name)) {
          throw new ServerError(ErrorCode.VALIDATION_ERROR, 'name may only contain letters, digits, dots, hyphens, and underscores', false, 400);
        }
        req.body.name = name;
      }

      const result = updateProfile(db, req.params.id, req.body);
      // Broadcast status change via SSE
      if (req.body.status && eventBus) {
        eventBus.emitAgentStatus({ agent_id: result.id, status: result.status });
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /admin/agents/:id — delete agent (admin-only)
  router.delete('/agents/:id', adminAuth, (req: AdminRequest, res, next) => {
    try {
      const agentId = req.params.id as string;
      const existing = db.prepare('SELECT id FROM profiles WHERE id = ?').get(agentId) as { id: string } | undefined;
      if (!existing) {
        throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Agent not found', false, 404);
      }
      deleteAgentCascade(db, agentId);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /admin/agents/batch-delete — batch delete agents (admin-only)
  router.post('/agents/batch-delete', adminAuth, (req: AdminRequest, res, next) => {
    try {
      const { agent_ids } = req.body as { agent_ids?: string[] };
      if (!Array.isArray(agent_ids) || agent_ids.length === 0) {
        throw new ServerError(ErrorCode.VALIDATION_ERROR, 'agent_ids must be a non-empty array', false, 400);
      }

      const results: Array<{ id: string; success: boolean; error?: string }> = [];
      for (const agentId of agent_ids) {
        try {
          const existing = db.prepare('SELECT id FROM profiles WHERE id = ?').get(agentId) as { id: string } | undefined;
          if (!existing) {
            results.push({ id: agentId, success: false, error: 'Agent not found' });
            continue;
          }
          deleteAgentCascade(db, agentId);
          results.push({ id: agentId, success: true });
        } catch (err) {
          results.push({ id: agentId, success: false, error: (err as Error).message });
        }
      }
      res.json({ results });
    } catch (err) {
      next(err);
    }
  });

  // POST /admin/agents/:id/token — regenerate agent token (admin-only)
  router.post('/agents/:id/token', adminAuth, (req: AdminRequest, res, next) => {
    try {
      const agentId = req.params.id as string;
      const existing = db.prepare('SELECT id FROM profiles WHERE id = ?').get(agentId) as { id: string } | undefined;
      if (!existing) {
        throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Agent not found', false, 404);
      }

      const { randomBytes } = require('node:crypto');
      const newToken = randomBytes(32).toString('hex');
      const newHash = hashToken(newToken);
      const now = new Date().toISOString();

      db.prepare('UPDATE profiles SET token_hash = ?, updated_at = ? WHERE id = ?').run(newHash, now, agentId);
      res.json({ id: agentId, token: newToken });
    } catch (err) {
      next(err);
    }
  });

  // --- Room Management (admin-only) ---

  // GET /admin/rooms — list all rooms (admin view, includes private)
  router.get('/rooms', adminAuth, (req, res, next) => {
    try {
      const rawLimit = req.query.limit ? Number(req.query.limit) : undefined;
      const limit = rawLimit !== undefined && Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 20;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (req.query.cursor) {
        try {
          const { created_at, id } = JSON.parse(Buffer.from(req.query.cursor as string, 'base64').toString()) as { created_at: string; id: string };
          conditions.push('(r.created_at < ? OR (r.created_at = ? AND r.id < ?))');
          params.push(created_at, created_at, id);
        } catch {
          // invalid cursor, ignore
        }
      }

      conditions.push("r.id NOT LIKE 'broadcast-%'");
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(Math.min(limit, 100) + 1);

      const rows = db.prepare(`
        SELECT r.*, COUNT(rm.agent_id) AS member_count
        FROM rooms r
        LEFT JOIN room_members rm ON rm.room_id = r.id
        ${where}
        GROUP BY r.id
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ?
      `).all(...params) as Array<Record<string, unknown>>;

      const hasMore = rows.length > Math.min(limit, 100);
      const items = hasMore ? rows.slice(0, -1) : rows;
      const last = items[items.length - 1];
      const nextCursor = hasMore && last
        ? Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString('base64')
        : undefined;

      res.json({ rooms: items, next_cursor: nextCursor });
    } catch (err) {
      next(err);
    }
  });

  // GET /admin/rooms/:id — room details (admin view)
  router.get('/rooms/:id', adminAuth, (req, res, next) => {
    try {
      const result = getRoom(db, req.params.id as string);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /admin/rooms — create room (admin-only)
  // Optionally pass agent_id to assign room ownership and auto-join that agent
  router.post('/rooms', adminAuth, (req: AdminRequest, res, next) => {
    try {
      const { randomUUID } = require('node:crypto');
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
        throw new ServerError(ErrorCode.VALIDATION_ERROR, `Room '${name}' already exists`, false, 409);
      }

      // If agent_id is provided, assign ownership to that agent and auto-join them
      const agentId = req.body.agent_id as string | undefined;
      const createdBy = agentId ?? 'system';

      if (agentId) {
        const agent = db.prepare('SELECT id FROM profiles WHERE id = ?').get(agentId) as { id: string } | undefined;
        if (!agent) {
          throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Agent not found', false, 404);
        }
      }

      db.prepare(
        'INSERT INTO rooms (id, name, description, visibility, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(id, name, req.body.description ?? '', visibility, createdBy, now);

      // Auto-join the agent if provided
      if (agentId) {
        db.prepare('INSERT OR IGNORE INTO room_members (room_id, agent_id, joined_at) VALUES (?, ?, ?)').run(id, agentId, now);
      }

      res.status(201).json({
        id,
        name,
        description: req.body.description ?? '',
        visibility,
        created_by: createdBy,
        created_at: now,
      });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /admin/rooms/:id — update room (admin-only)
  router.patch('/rooms/:id', adminAuth, (req: AdminRequest, res, next) => {
    try {
      const roomId = req.params.id as string;
      const existing = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId) as { id: string } | undefined;
      if (!existing) {
        throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Room not found', false, 404);
      }

      const { name, description, visibility } = req.body as { name?: string; description?: string; visibility?: string };
      const updates: string[] = [];
      const params: unknown[] = [];

      if (name !== undefined) {
        const trimmed = String(name).trim();
        if (!trimmed || trimmed.length > 64) {
          throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Room name must be 1-64 characters', false, 400);
        }
        // Check uniqueness
        const dup = db.prepare('SELECT id FROM rooms WHERE name = ? AND id != ?').get(trimmed, roomId);
        if (dup) {
          throw new ServerError(ErrorCode.VALIDATION_ERROR, `Room name '${trimmed}' already exists`, false, 409);
        }
        updates.push('name = ?');
        params.push(trimmed);
      }
      if (description !== undefined) {
        updates.push('description = ?');
        params.push(String(description));
      }
      if (visibility !== undefined) {
        if (visibility !== 'public' && visibility !== 'private') {
          throw new ServerError(ErrorCode.VALIDATION_ERROR, 'visibility must be public or private', false, 400);
        }
        updates.push('visibility = ?');
        params.push(visibility);
      }

      if (updates.length === 0) {
        throw new ServerError(ErrorCode.VALIDATION_ERROR, 'No fields to update', false, 400);
      }

      params.push(roomId);
      db.prepare(`UPDATE rooms SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      const result = getRoom(db, roomId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /admin/rooms/:id — delete room (admin-only)
  router.delete('/rooms/:id', adminAuth, (req: AdminRequest, res, next) => {
    try {
      const roomId = req.params.id as string;
      const existing = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId) as { id: string } | undefined;
      if (!existing) {
        throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Room not found', false, 404);
      }
      deleteRoomCascade(db, roomId);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
