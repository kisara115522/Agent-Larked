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

describe('Coverage gaps', () => {
  it('POST /rooms/:id/leave removes membership', async () => {
    const owner = await request(app).post('/agents').send({ name: 'LeaveBot1' }).expect(201);
    const member = await request(app).post('/agents').send({ name: 'LeaveBot2' }).expect(201);
    const room = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'leave-room-1' })
      .expect(201);

    await request(app)
      .post(`/rooms/${room.body.id}/join`)
      .set('Authorization', `Bearer ${member.body.token}`)
      .expect(200);

    await request(app)
      .post(`/rooms/${room.body.id}/leave`)
      .set('Authorization', `Bearer ${member.body.token}`)
      .expect(200);

    // After leaving, member can't post messages
    await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${member.body.token}`)
      .send({ room_id: room.body.id, content: 'Should fail', idempotency_key: 'leave-test' })
      .expect(403);
  });

  it('GET /agents with cursor pagination', async () => {
    // Register multiple agents
    for (let i = 0; i < 5; i++) {
      await request(app).post('/agents').send({ name: `PageBot${i}` }).expect(201);
    }

    const reg = await request(app).post('/agents').send({ name: 'PageBotSelf' }).expect(201);

    // First page with limit 2
    const page1 = await request(app)
      .get('/agents?limit=2')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);

    expect(page1.body.agents.length).toBeLessThanOrEqual(2);
    expect(page1.body.has_more).toBe(true);
    expect(page1.body.next_cursor).toBeDefined();

    // Second page
    if (page1.body.next_cursor) {
      const page2 = await request(app)
        .get(`/agents?limit=2&cursor=${page1.body.next_cursor}`)
        .set('Authorization', `Bearer ${reg.body.token}`)
        .expect(200);

      expect(page2.body.agents.length).toBeLessThanOrEqual(2);
    }
  });

  it('POST /messages rejects content > 1MB', async () => {
    const reg = await request(app).post('/agents').send({ name: 'SizeBot' }).expect(201);
    const room = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ name: 'size-room' })
      .expect(201);

    const bigContent = 'x'.repeat(1_048_577); // 1MB + 1 byte

    await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ room_id: room.body.id, content: bigContent, idempotency_key: 'size-test' })
      .expect(400);
  });

  it('GET /rooms/:id/messages cursor pagination', async () => {
    const reg = await request(app).post('/agents').send({ name: 'CursorBot' }).expect(201);
    const room = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ name: 'cursor-room' })
      .expect(201);

    // Send 5 messages
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/messages')
        .set('Authorization', `Bearer ${reg.body.token}`)
        .send({ room_id: room.body.id, content: `msg-${i}`, idempotency_key: `cursor-${i}` })
        .expect(201);
    }

    // First page: limit 2
    const page1 = await request(app)
      .get(`/rooms/${room.body.id}/messages?limit=2`)
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);

    expect(page1.body.messages).toHaveLength(2);
    expect(page1.body.has_more).toBe(true);
    expect(page1.body.next_cursor).toBeDefined();

    // Second page with cursor
    const page2 = await request(app)
      .get(`/rooms/${room.body.id}/messages?limit=2&cursor=${page1.body.next_cursor}`)
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);

    expect(page2.body.messages).toHaveLength(2);

    // Verify no overlap
    const page1Ids = page1.body.messages.map((m: { id: string }) => m.id);
    const page2Ids = page2.body.messages.map((m: { id: string }) => m.id);
    const overlap = page1Ids.filter((id: string) => page2Ids.includes(id));
    expect(overlap).toHaveLength(0);
  });
});
