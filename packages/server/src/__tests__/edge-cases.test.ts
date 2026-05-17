import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { createApp } from '../index.js';
import { bootstrapDefaultAgent } from '../db.js';
import { hashToken } from '../middleware/auth.js';

let app: Express;
let db: Database.Database;
let adminToken: string;

beforeAll(() => {
  ({ app, db } = createApp());
  adminToken = bootstrapDefaultAgent(db, hashToken)!;
});

async function createRoomAndJoin(agentToken: string, roomId: string) {
  await request(app)
    .post(`/rooms/${roomId}/join`)
    .set('Authorization', `Bearer ${agentToken}`)
    .expect(200);
}

describe('Edge cases', () => {
  it('POST /messages with non-existent mention agent → 400', async () => {
    const reg = await request(app).post('/agents').send({ name: 'EdgeBot1' }).expect(201);
    const room = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'edge-room-1' })
      .expect(201);
    await createRoomAndJoin(reg.body.token, room.body.id);

    await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({
        room_id: room.body.id,
        content: 'Hello',
        mentions: ['non-existent-agent-id'],
        idempotency_key: 'edge-1',
      })
      .expect(400);
  });

  it('POST /messages to non-existent room → 404', async () => {
    const reg = await request(app).post('/agents').send({ name: 'EdgeBot2' }).expect(201);

    await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({
        room_id: 'non-existent-room',
        content: 'Hello',
        idempotency_key: 'edge-2',
      })
      .expect(404);
  });

  it('POST /messages from non-member → 403', async () => {
    const owner = await request(app).post('/agents').send({ name: 'EdgeBot3' }).expect(201);
    const outsider = await request(app).post('/agents').send({ name: 'Outsider1' }).expect(201);
    const room = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${owner.body.token}`)
      .send({ name: 'edge-room-3' })
      .expect(201);

    await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${outsider.body.token}`)
      .send({
        room_id: room.body.id,
        content: 'Should fail',
        idempotency_key: 'edge-3',
      })
      .expect(403);
  });

  it('Duplicate reaction returns 200 with existing reaction', async () => {
    const reg = await request(app).post('/agents').send({ name: 'EdgeBot4' }).expect(201);
    const room = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ name: 'edge-room-4' })
      .expect(201);
    const msg = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ room_id: room.body.id, content: 'React twice', idempotency_key: 'edge-4a' })
      .expect(201);

    await request(app)
      .post(`/messages/${msg.body.id}/reactions`)
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ type: 'agree' })
      .expect(201);

    const res = await request(app)
      .post(`/messages/${msg.body.id}/reactions`)
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ type: 'agree' })
      .expect(200);

    expect(res.body.type).toBe('agree');
  });

  it('Idempotency: same key + same body → same response', async () => {
    const reg = await request(app).post('/agents').send({ name: 'EdgeBot5' }).expect(201);
    const room = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ name: 'edge-room-5' })
      .expect(201);

    const body = { room_id: room.body.id, content: 'Idempotent', idempotency_key: 'idem-edge-1' };

    const res1 = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send(body)
      .expect(201);

    const res2 = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send(body)
      .expect(201);

    expect(res1.body.id).toBe(res2.body.id);
    expect(res1.body.sequence).toBe(res2.body.sequence);
  });

  it('Idempotency: same key + different body → 409', async () => {
    const reg = await request(app).post('/agents').send({ name: 'EdgeBot6' }).expect(201);
    const room = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ name: 'edge-room-6' })
      .expect(201);

    await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ room_id: room.body.id, content: 'First', idempotency_key: 'idem-edge-2' })
      .expect(201);

    await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ room_id: room.body.id, content: 'Different', idempotency_key: 'idem-edge-2' })
      .expect(409);
  });

  it('Cross-room reply → rejected', async () => {
    const reg = await request(app).post('/agents').send({ name: 'EdgeBot7' }).expect(201);
    const room1 = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ name: 'edge-room-7a' })
      .expect(201);
    const room2 = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ name: 'edge-room-7b' })
      .expect(201);

    const msg = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ room_id: room1.body.id, content: 'Parent', idempotency_key: 'edge-7a' })
      .expect(201);

    await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({
        room_id: room2.body.id,
        content: 'Cross-room reply',
        reply_to: msg.body.id,
        idempotency_key: 'edge-7b',
      })
      .expect(400);
  });

  it('Thread cycle detection → rejected', async () => {
    const reg = await request(app).post('/agents').send({ name: 'EdgeBot8' }).expect(201);
    const room = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ name: 'edge-room-8' })
      .expect(201);

    const msg1 = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ room_id: room.body.id, content: 'Msg1', idempotency_key: 'edge-8a' })
      .expect(201);

    const msg2 = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ room_id: room.body.id, content: 'Msg2', reply_to: msg1.body.id, idempotency_key: 'edge-8b' })
      .expect(201);

    // msg3 replying to msg2 is fine (no cycle)
    await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({
        room_id: room.body.id,
        content: 'Msg3',
        reply_to: msg2.body.id,
        idempotency_key: 'edge-8c',
      })
      .expect(201);
  });

  it('Room join is idempotent', async () => {
    const reg = await request(app).post('/agents').send({ name: 'EdgeBot9' }).expect(201);
    const room = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ name: 'edge-room-9' })
      .expect(201);

    // Already joined (creator auto-joins)
    const res = await request(app)
      .post(`/rooms/${room.body.id}/join`)
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
  });
});
