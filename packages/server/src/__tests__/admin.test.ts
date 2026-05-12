import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import Database, { type Database as SqliteDatabase } from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../index.js';
import { bootstrapDefaultAdmin, createDatabase } from '../db.js';
import { hashToken } from '../middleware/auth.js';

describe('Agent Admin RBAC', () => {
  let app: Express;
  let db: SqliteDatabase;
  let adminToken: string;
  let adminId: string;

  beforeAll(() => {
    ({ app, db } = createApp());
    adminToken = bootstrapDefaultAdmin(db, hashToken)!;
    const row = db.prepare('SELECT id FROM profiles WHERE name = ? AND is_admin = 1').get('kisara') as { id: string };
    adminId = row.id;
  });

  describe('Admin bootstrap', () => {
    it('default admin kisara is created as an agent admin', () => {
      expect(adminToken).toBeTruthy();
      expect(adminId).toBeTruthy();
    });

    it('does not keep the legacy human admin table', () => {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'human_users'").get();
      expect(row).toBeUndefined();
    });

    it('drops legacy human admin tables when opening an existing database', () => {
      const dir = mkdtempSync(join(tmpdir(), 'flock-admin-'));
      const dbPath = join(dir, 'legacy.db');

      const legacy = createDatabase(dbPath);
      legacy.exec(`
        CREATE TABLE IF NOT EXISTS human_users (id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS admin_audit_log (id TEXT PRIMARY KEY);
      `);
      legacy.close();

      const migrated = createDatabase(dbPath);
      try {
        const humanUsers = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'human_users'").get();
        const adminAuditLog = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_audit_log'").get();
        expect(humanUsers).toBeUndefined();
        expect(adminAuditLog).toBeUndefined();
      } finally {
        migrated.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('migrates room and message profile foreign keys to preserve history', () => {
      const dir = mkdtempSync(join(tmpdir(), 'flock-room-fk-'));
      const dbPath = join(dir, 'legacy-room-fk.db');
      const legacy = new Database(dbPath);
      try {
        legacy.pragma('foreign_keys = ON');
        legacy.exec(`
          CREATE TABLE profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            token_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE rooms (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            description TEXT DEFAULT '',
            visibility TEXT DEFAULT 'public',
            created_by TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL
          );
          CREATE TABLE messages (
            id TEXT PRIMARY KEY,
            from_agent TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            reply_to TEXT REFERENCES messages(id) ON DELETE SET NULL,
            broadcast INTEGER DEFAULT 0,
            sequence INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            created_order INTEGER NOT NULL,
            UNIQUE(room_id, sequence),
            UNIQUE(created_order)
          );
          INSERT INTO profiles (id, name, token_hash, created_at, updated_at)
          VALUES ('creator-id', 'creator', 'hash', '2026-05-12T00:00:00.000Z', '2026-05-12T00:00:00.000Z');
          INSERT INTO rooms (id, name, created_by, created_at)
          VALUES ('room-id', 'legacy-room', 'creator-id', '2026-05-12T00:00:00.000Z');
          INSERT INTO messages (id, from_agent, room_id, content, sequence, created_at, created_order)
          VALUES ('message-id', 'creator-id', 'room-id', 'legacy message', 1, '2026-05-12T00:00:00.000Z', 1);
        `);
      } finally {
        legacy.close();
      }

      const migrated = createDatabase(dbPath);
      try {
        const fk = migrated.prepare("PRAGMA foreign_key_list('rooms')").all() as Array<{ from: string; on_delete: string }>;
        expect(fk.find(row => row.from === 'created_by')?.on_delete).toBe('SET NULL');
        const messageFk = migrated.prepare("PRAGMA foreign_key_list('messages')").all() as Array<{ from: string; on_delete: string }>;
        expect(messageFk.find(row => row.from === 'from_agent')?.on_delete).toBe('SET DEFAULT');

        migrated.prepare('DELETE FROM profiles WHERE id = ?').run('creator-id');

        const room = migrated.prepare('SELECT id, created_by FROM rooms WHERE id = ?').get('room-id') as { id: string; created_by: string | null } | undefined;
        expect(room).toEqual({ id: 'room-id', created_by: null });

        const message = migrated.prepare('SELECT id, room_id, from_agent FROM messages WHERE id = ?').get('message-id');
        expect(message).toEqual({ id: 'message-id', room_id: 'room-id', from_agent: '[deleted]' });
        expect(migrated.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      } finally {
        migrated.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('default admin kisara logs in through the normal agent login endpoint', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ identifier: 'kisara', token: adminToken })
        .expect(200);

      expect(res.body.name).toBe('kisara');
      expect(res.body.is_admin).toBe(true);
    });

    it('bootstrap is idempotent — second call returns null', () => {
      const second = bootstrapDefaultAdmin(db, hashToken);
      expect(second).toBeNull();
    });
  });

  describe('GET /admin/me', () => {
    it('returns the current admin agent profile', async () => {
      const res = await request(app)
        .get('/admin/me')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.name).toBe('kisara');
      expect(res.body.is_admin).toBe(true);
      // Should NOT return token_hash
      expect(res.body.token_hash).toBeUndefined();
    });

    it('rejects a non-admin agent token', async () => {
      // Register an agent
      const reg = await request(app)
        .post('/agents')
        .send({ name: 'test-agent-admin-me' })
        .expect(201);

      await request(app)
        .get('/admin/me')
        .set('Authorization', `Bearer ${reg.body.token}`)
        .expect(403);
    });
  });

  describe('Admin-only Agent CRUD', () => {
    let agentId: string;
    let agentToken: string;

    beforeEach(async () => {
      const reg = await request(app)
        .post('/agents')
        .send({ name: `test-agent-${Date.now()}-${Math.random().toString(16).slice(2)}` })
        .expect(201);
      agentId = reg.body.id;
      agentToken = reg.body.token;
    });

    it('admin can create agent via POST /admin/agents', async () => {
      const res = await request(app)
        .post('/admin/agents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `admin-created-${Date.now()}`, capabilities: ['test'] })
        .expect(201);

      expect(res.body.id).toBeTruthy();
      expect(res.body.token).toBeTruthy();
    });

    it('admin can delete agent via DELETE /admin/agents/:id', async () => {
      await request(app)
        .delete(`/admin/agents/${agentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('admin can delete an agent with messages, direct messages, and owned rooms', async () => {
      const target = await request(app)
        .post('/agents')
        .send({ name: `delete-with-history-${Date.now()}` })
        .expect(201);
      const peer = await request(app)
        .post('/agents')
        .send({ name: `delete-peer-${Date.now()}` })
        .expect(201);

      const ownedRoom = await request(app)
        .post('/admin/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `owned-by-delete-${Date.now()}`, agent_id: target.body.id })
        .expect(201);
      await request(app)
        .post('/messages')
        .set('Authorization', `Bearer ${target.body.token}`)
        .send({ room_id: ownedRoom.body.id, content: 'message before delete', idempotency_key: 'delete-history-message' })
        .expect(201);
      await request(app)
        .post(`/direct-chats/${peer.body.id}/messages`)
        .set('Authorization', `Bearer ${target.body.token}`)
        .send({ content: 'private before delete', idempotency_key: 'delete-history-dm' })
        .expect(201);

      await request(app)
        .delete(`/admin/agents/${target.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const remainingAgent = db.prepare('SELECT id FROM profiles WHERE id = ?').get(target.body.id);
      expect(remainingAgent).toBeUndefined();
      const remainingRoom = db.prepare('SELECT created_by FROM rooms WHERE id = ?').get(ownedRoom.body.id) as { created_by: string | null } | undefined;
      expect(remainingRoom).toEqual({ created_by: null });
      const remainingMessage = db.prepare('SELECT from_agent FROM messages WHERE room_id = ?').get(ownedRoom.body.id) as { from_agent: string } | undefined;
      expect(remainingMessage).toEqual({ from_agent: '[deleted]' });
      const dangling = db.prepare('PRAGMA foreign_key_check').all();
      expect(dangling).toEqual([]);
    });

    it('deleting a room creator preserves the room and its messages', async () => {
      const creator = await request(app)
        .post('/agents')
        .send({ name: `creator-delete-${Date.now()}` })
        .expect(201);

      const room = await request(app)
        .post('/admin/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `creator-room-${Date.now()}`, agent_id: creator.body.id })
        .expect(201);

      await request(app)
        .post('/messages')
        .set('Authorization', `Bearer ${creator.body.token}`)
        .send({ room_id: room.body.id, content: 'history must survive', idempotency_key: 'creator-delete-message' })
        .expect(201);

      await request(app)
        .delete(`/admin/agents/${creator.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const remainingRoom = db.prepare('SELECT id, created_by FROM rooms WHERE id = ?').get(room.body.id) as { id: string; created_by: string | null } | undefined;
      expect(remainingRoom).toEqual({ id: room.body.id, created_by: null });

      const messages = db.prepare('SELECT content, from_agent FROM messages WHERE room_id = ?').all(room.body.id);
      expect(messages).toEqual([{ content: 'history must survive', from_agent: '[deleted]' }]);
    });

    it('hides reserved profiles from admin agent lists and rejects reserved profile deletion', async () => {
      const res = await request(app)
        .get('/admin/agents')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const ids = res.body.agents.map((agent: { id: string }) => agent.id);
      expect(ids).not.toContain('system');
      expect(ids).not.toContain('[deleted]');

      await request(app)
        .delete('/admin/agents/system')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);

      await request(app)
        .delete('/admin/agents/%5Bdeleted%5D')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);

      const isolated = createApp();
      bootstrapDefaultAdmin(isolated.db, hashToken);
      isolated.db.prepare('UPDATE profiles SET token_hash = ? WHERE id = ?').run(hashToken('reserved-token'), 'system');
      await request(isolated.app)
        .post('/auth/login')
        .send({ identifier: 'system', token: 'reserved-token' })
        .expect(403);
    });

    it('admin can batch delete via POST /admin/agents/batch-delete', async () => {
      const res = await request(app)
        .post('/admin/agents/batch-delete')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ agent_ids: [agentId] })
        .expect(200);

      expect(res.body.results[0].success).toBe(true);
    });

    it('admin can regenerate agent token via POST /admin/agents/:id/token', async () => {
      const res = await request(app)
        .post(`/admin/agents/${agentId}/token`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.token).toBeTruthy();
      expect(res.body.id).toBe(agentId);
    });

    it('admin can update agent via PATCH /admin/agents/:id', async () => {
      const res = await request(app)
        .patch(`/admin/agents/${agentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ display_name: 'Updated by Admin', bio: 'admin bio' })
        .expect(200);

      expect(res.body.display_name).toBe('Updated by Admin');
    });

    it('agent token cannot access admin endpoints', async () => {
      await request(app)
        .get('/admin/agents')
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(403);

      await request(app)
        .delete(`/admin/agents/${agentId}`)
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(403);
    });

    it('legacy DELETE /agents/:id requires admin', async () => {
      // Agent token should get 403
      await request(app)
        .delete(`/agents/${agentId}`)
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(403);

      // Admin agent token should work
      await request(app)
        .delete(`/agents/${agentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('legacy POST /agents/batch-delete requires admin', async () => {
      await request(app)
        .post('/agents/batch-delete')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ agent_ids: [agentId] })
        .expect(403);
    });

    it('legacy POST /agents/:id/token requires admin', async () => {
      await request(app)
        .post(`/agents/${agentId}/token`)
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(403);
    });
  });

  describe('Admin-only Room CRUD', () => {
    it('admin can create room via POST /admin/rooms', async () => {
      const res = await request(app)
        .post('/admin/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `admin-room-${Date.now()}`, description: 'Admin created room' })
        .expect(201);

      expect(res.body.id).toBeTruthy();
    });

    it('admin can list all rooms via GET /admin/rooms', async () => {
      const res = await request(app)
        .get('/admin/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.rooms).toBeDefined();
    });

    it('admin can delete room via DELETE /admin/rooms/:id', async () => {
      const createRes = await request(app)
        .post('/admin/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `del-room-${Date.now()}` })
        .expect(201);

      await request(app)
        .delete(`/admin/rooms/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('admin can update room via PATCH /admin/rooms/:id', async () => {
      const createRes = await request(app)
        .post('/admin/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `upd-room-${Date.now()}` })
        .expect(201);

      const res = await request(app)
        .patch(`/admin/rooms/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: 'Updated description', visibility: 'private' })
        .expect(200);

      expect(res.body.description).toBe('Updated description');
      expect(res.body.visibility).toBe('private');
    });

    it('legacy POST /rooms requires admin', async () => {
      // Register an agent
      const reg = await request(app)
        .post('/agents')
        .send({ name: 'room-test-agent' })
        .expect(201);

      // Agent token should get 403 for room creation
      await request(app)
        .post('/rooms')
        .set('Authorization', `Bearer ${reg.body.token}`)
        .send({ name: `agent-room-${Date.now()}` })
        .expect(403);
    });

    it('agent can still join/leave rooms', async () => {
      // Admin creates room
      const roomRes = await request(app)
        .post('/admin/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `join-room-${Date.now()}` })
        .expect(201);

      // Register agent
      const reg = await request(app)
        .post('/agents')
        .send({ name: 'join-test-agent' })
        .expect(201);

      // Agent can join
      await request(app)
        .post(`/rooms/${roomRes.body.id}/join`)
        .set('Authorization', `Bearer ${reg.body.token}`)
        .expect(200);

      // Agent can leave
      await request(app)
        .post(`/rooms/${roomRes.body.id}/leave`)
        .set('Authorization', `Bearer ${reg.body.token}`)
        .expect(200);
    });
  });

  describe('Admin sees all rooms including private', () => {
    it('admin GET /admin/rooms includes private rooms', async () => {
      // Create private room
      await request(app)
        .post('/admin/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `private-${Date.now()}`, visibility: 'private' })
        .expect(201);

      const res = await request(app)
        .get('/admin/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const privateRoom = res.body.rooms.find((r: any) => r.visibility === 'private');
      expect(privateRoom).toBeTruthy();
    });
  });
});
