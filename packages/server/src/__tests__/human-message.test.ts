import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { createApp } from '../index.js';
import { bootstrapDefaultAgent } from '../db.js';
import { hashToken } from '../middleware/auth.js';

let app: Express;
let db: Database.Database;

describe('Human Messages', () => {
  let humanToken: string;
  let humanId: string;
  let roomId: string;

  beforeAll(async () => {
    ({ app, db } = createApp());
    bootstrapDefaultAgent(db, hashToken);

    // Register human
    const reg = await request(app)
      .post('/human/register')
      .send({ username: 'testhuman', password: 'password123', display_name: 'Test Human' })
      .expect(201);

    humanToken = reg.body.token;
    humanId = reg.body.id;

    // Create a room using an agent (human can't create rooms yet)
    const agentReg = await request(app).post('/agents').send({ name: 'RoomCreator' }).expect(201);
    const roomRes = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${agentReg.body.token}`)
      .send({ name: 'human-test-room' })
      .expect(201);
    roomId = roomRes.body.id;

    // Join human to the room via human auth endpoint
    await request(app)
      .post(`/rooms/${roomId}/join/human`)
      .set('Authorization', `Bearer ${humanToken}`)
      .expect(200);
  });

  it('human can send message to room', async () => {
    const res = await request(app)
      .post(`/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${humanToken}`)
      .send({ content: 'Hello from human!' })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.sequence).toBeDefined();
  });

  it('message has sender_type human', async () => {
    // Read messages from an agent's perspective
    const agentReg = await request(app).post('/agents').send({ name: 'Reader' }).expect(201);
    await request(app)
      .post(`/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${agentReg.body.token}`)
      .expect(200);

    const messages = await request(app)
      .get(`/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${agentReg.body.token}`)
      .expect(200);

    const humanMsg = messages.body.messages.find((m: { content: string }) => m.content === 'Hello from human!');
    expect(humanMsg).toBeDefined();
    expect(humanMsg.sender_type).toBe('human');
  });

  it('human cannot send to room they are not a member of', async () => {
    const agentReg = await request(app).post('/agents').send({ name: 'PrivateAgent' }).expect(201);
    const privateRoom = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${agentReg.body.token}`)
      .send({ name: 'private-room-human' })
      .expect(201);

    await request(app)
      .post(`/rooms/${privateRoom.body.id}/messages`)
      .set('Authorization', `Bearer ${humanToken}`)
      .send({ content: 'should fail' })
      .expect(403);
  });
});
