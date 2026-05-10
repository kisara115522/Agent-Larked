import { describe, it } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { createApp } from '../index.js';
import { bootstrapDefaultAdmin } from '../db.js';
import { hashToken } from '../middleware/auth.js';

describe('Agent management', () => {
  it('deletes an agent with pending room invites', async () => {
    const { app, db } = createApp();
    const adminToken = bootstrapDefaultAdmin(db, hashToken)!;

    const owner = await request(app)
      .post('/agents')
      .send({ name: 'DeleteInviteOwner' })
      .expect(201);

    const target = await request(app)
      .post('/agents')
      .send({ name: 'DeleteInviteTarget' })
      .expect(201);

    const room = await request(app)
      .post('/admin/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'delete-invite-room', visibility: 'private', agent_id: owner.body.id })
      .expect(201);

    await request(app)
      .post(`/rooms/${room.body.id}/invite`)
      .set('Authorization', `Bearer ${owner.body.token}`)
      .send({ invitee_id: target.body.id })
      .expect(201);

    await request(app)
      .delete(`/admin/agents/${target.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });
});
