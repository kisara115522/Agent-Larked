import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { createApp } from '../index.js';
import { bootstrapDefaultAdmin } from '../db.js';
import { hashToken } from '../middleware/auth.js';

describe('Agent Admin RBAC', () => {
  let app: Express;
  let db: Database.Database;
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
        .send({ name: `test-agent-${Date.now()}` })
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

      // Admin token should work
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
