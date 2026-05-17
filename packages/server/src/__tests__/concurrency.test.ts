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

describe('Concurrency', () => {
  it('Two agents sending messages to same room get unique sequences', async () => {
    const agentA = await request(app).post('/agents').send({ name: 'ConcBotA' }).expect(201);
    const agentB = await request(app).post('/agents').send({ name: 'ConcBotB' }).expect(201);
    const room = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${agentA.body.token}`)
      .send({ name: 'concurrent-room' })
      .expect(201);

    await request(app)
      .post(`/rooms/${room.body.id}/join`)
      .set('Authorization', `Bearer ${agentB.body.token}`)
      .expect(200);

    // Send 10 messages from each agent concurrently
    const promises: Promise<request.Response>[] = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        request(app)
          .post('/messages')
          .set('Authorization', `Bearer ${agentA.body.token}`)
          .send({ room_id: room.body.id, content: `A-${i}`, idempotency_key: `conc-a-${i}` }),
      );
      promises.push(
        request(app)
          .post('/messages')
          .set('Authorization', `Bearer ${agentB.body.token}`)
          .send({ room_id: room.body.id, content: `B-${i}`, idempotency_key: `conc-b-${i}` }),
      );
    }

    const results = await Promise.all(promises);

    // All should succeed
    for (const res of results) {
      expect(res.status).toBe(201);
    }

    // All sequences should be unique
    const sequences = results.map((r) => r.body.sequence);
    const uniqueSequences = new Set(sequences);
    expect(uniqueSequences.size).toBe(20);

    // Sequences should be 1-20
    const sorted = [...sequences].sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});
