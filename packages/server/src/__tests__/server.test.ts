import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { createApp } from '../index.js';
import { bootstrapDefaultAdmin } from '../db.js';
import { hashToken } from '../middleware/auth.js';

let app: Express;
let db: Database.Database;
let adminToken: string;

beforeAll(() => {
  ({ app, db } = createApp()); // in-memory SQLite
  adminToken = bootstrapDefaultAdmin(db, hashToken)!;
});

describe('Agent Registration', () => {
  it('POST /agents registers a new agent', async () => {
    const res = await request(app)
      .post('/agents')
      .send({ name: 'TestBot', capabilities: ['code-review'] })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('TestBot');
    expect(res.body.token).toBeDefined();
    expect(res.body.token).toHaveLength(64); // 32 bytes hex
  });

  it('POST /agents rejects duplicate name', async () => {
    await request(app)
      .post('/agents')
      .send({ name: 'TestBot' })
      .expect(409);
  });

  it('PATCH /agents/:id updates profile', async () => {
    // Register first
    const reg = await request(app)
      .post('/agents')
      .send({ name: 'UpdateBot' })
      .expect(201);

    const res = await request(app)
      .patch(`/agents/${reg.body.id}`)
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ status: 'online', bio: 'Updated bio' })
      .expect(200);

    expect(res.body.status).toBe('online');
    expect(res.body.bio).toBe('Updated bio');
  });
});

describe('Room Operations', () => {
  let agentToken: string;
  let agentId: string;

  beforeAll(async () => {
    const reg = await request(app)
      .post('/agents')
      .send({ name: 'RoomBot' })
      .expect(201);
    agentToken = reg.body.token;
    agentId = reg.body.id;
  });

  it('POST /rooms creates a room', async () => {
    const res = await request(app)
      .post('/admin/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'test-room', description: 'A test room' })
      .expect(201);

    expect(res.body.name).toBe('test-room');
    expect(res.body.created_by).toBe('system');
  });

  it('POST /rooms/:id/join joins a room', async () => {
    // Create another agent
    const reg = await request(app)
      .post('/agents')
      .send({ name: 'JoinBot' })
      .expect(201);

    // Create room
    const room = await request(app)
      .post('/admin/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'join-test' })
      .expect(201);

    // Join
    await request(app)
      .post(`/rooms/${room.body.id}/join`)
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);
  });
});

describe('Messaging', () => {
  let agentToken: string;
  let agentId: string;
  let roomId: string;

  beforeAll(async () => {
    const reg = await request(app)
      .post('/agents')
      .send({ name: 'MsgBot' })
      .expect(201);
    agentToken = reg.body.token;
    agentId = reg.body.id;

    const room = await request(app)
      .post('/admin/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'msg-room', agent_id: agentId })
      .expect(201);
    roomId = room.body.id;
  });

  it('POST /messages sends a message', async () => {
    const res = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        room_id: roomId,
        content: 'Hello world',
        idempotency_key: 'key-1',
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.sequence).toBe(1);
  });

  it('GET /rooms/:id/messages returns messages', async () => {
    const res = await request(app)
      .get(`/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(res.body.messages.length).toBeGreaterThan(0);
    expect(res.body.messages[0].content).toBe('Hello world');
  });

  it('POST /messages is idempotent', async () => {
    const res1 = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        room_id: roomId,
        content: 'Idempotent test',
        idempotency_key: 'idem-key-1',
      })
      .expect(201);

    const res2 = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        room_id: roomId,
        content: 'Idempotent test',
        idempotency_key: 'idem-key-1',
      })
      .expect(201);

    expect(res1.body.id).toBe(res2.body.id);
    expect(res1.body.sequence).toBe(res2.body.sequence);
  });

  it('POST /messages rejects non-member', async () => {
    const reg = await request(app)
      .post('/agents')
      .send({ name: 'Outsider' })
      .expect(201);

    await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({
        room_id: roomId,
        content: 'Should fail',
        idempotency_key: 'outsider-key',
      })
      .expect(403);
  });
});

describe('Thread', () => {
  it('GET /messages/:id/thread returns reply chain', async () => {
    const reg = await request(app)
      .post('/agents')
      .send({ name: 'ThreadBot' })
      .expect(201);

    const room = await request(app)
      .post('/admin/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'thread-room', agent_id: reg.body.id })
      .expect(201);

    // Send parent
    const parent = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({
        room_id: room.body.id,
        content: 'Parent message',
        idempotency_key: 'thread-parent',
      })
      .expect(201);

    // Send reply
    await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({
        room_id: room.body.id,
        content: 'Reply message',
        reply_to: parent.body.id,
        idempotency_key: 'thread-reply',
      })
      .expect(201);

    // Get thread
    const res = await request(app)
      .get(`/messages/${parent.body.id}/thread`)
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);

    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[0].content).toBe('Parent message');
    expect(res.body.messages[1].content).toBe('Reply message');
  });
});

describe('Reaction', () => {
  it('POST /messages/:id/reactions adds a reaction', async () => {
    const reg = await request(app)
      .post('/agents')
      .send({ name: 'ReactBot' })
      .expect(201);

    const room = await request(app)
      .post('/admin/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'react-room', agent_id: reg.body.id })
      .expect(201);

    const msg = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({
        room_id: room.body.id,
        content: 'React to this',
        idempotency_key: 'react-msg',
      })
      .expect(201);

    const res = await request(app)
      .post(`/messages/${msg.body.id}/reactions`)
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ type: 'useful' })
      .expect(201);

    expect(res.body.type).toBe('useful');
  });
});

describe('Auth', () => {
  it('rejects requests without token', async () => {
    await request(app)
      .get('/agents')
      .expect(401);
  });

  it('rejects invalid token', async () => {
    await request(app)
      .get('/agents')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });
});

describe('GET /agents/me', () => {
  it('returns current agent profile', async () => {
    const reg = await request(app)
      .post('/agents')
      .send({ name: 'MeBot', bio: 'I am me', capabilities: ['test'] })
      .expect(201);

    const res = await request(app)
      .get('/agents/me')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);

    expect(res.body.name).toBe('MeBot');
    expect(res.body.bio).toBe('I am me');
    expect(res.body.capabilities).toEqual(['test']);
    expect(res.body.id).toBe(reg.body.id);
    // Should NOT include token_hash
    expect(res.body.token_hash).toBeUndefined();
  });
});

describe('GET /rooms', () => {
  it('lists all rooms', async () => {
    const reg = await request(app)
      .post('/agents')
      .send({ name: 'ListBot' })
      .expect(201);

    // Create a few rooms
    await request(app)
      .post('/admin/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'list-room-1', description: 'First' })
      .expect(201);

    await request(app)
      .post('/admin/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'list-room-2', description: 'Second' })
      .expect(201);

    const res = await request(app)
      .get('/rooms')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);

    expect(res.body.rooms.length).toBeGreaterThanOrEqual(2);
    expect(res.body.rooms[0].name).toBeDefined();
    expect(res.body.rooms[0].member_count).toBeDefined();
    expect(typeof res.body.rooms[0].member_count).toBe('number');
  });

  it('supports cursor pagination', async () => {
    const reg = await request(app)
      .post('/agents')
      .send({ name: 'PageBot' })
      .expect(201);

    const res = await request(app)
      .get('/rooms?limit=1')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);

    expect(res.body.rooms).toHaveLength(1);
    // has_more depends on total rooms count
    expect(typeof res.body.has_more).toBe('boolean');
  });
});

describe('GET /rooms/:id', () => {
  it('returns room details with member count', async () => {
    const reg = await request(app)
      .post('/agents')
      .send({ name: 'DetailBot' })
      .expect(201);

    const room = await request(app)
      .post('/admin/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'detail-room', description: 'Detail test' })
      .expect(201);

    // Agent must join since admin-created rooms don't auto-join
    await request(app)
      .post(`/rooms/${room.body.id}/join`)
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);

    const res = await request(app)
      .get(`/rooms/${room.body.id}`)
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);

    expect(res.body.name).toBe('detail-room');
    expect(res.body.description).toBe('Detail test');
    expect(res.body.member_count).toBe(1); // agent joined
  });

  it('returns 404 for non-existent room', async () => {
    const reg = await request(app)
      .post('/agents')
      .send({ name: 'NotFoundBot' })
      .expect(201);

    await request(app)
      .get('/rooms/non-existent-id')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(404);
  });
});

describe('GET /rooms/:id/members', () => {
  it('returns room member list', async () => {
    const reg1 = await request(app)
      .post('/agents')
      .send({ name: 'MemberBot1' })
      .expect(201);

    const reg2 = await request(app)
      .post('/agents')
      .send({ name: 'MemberBot2' })
      .expect(201);

    const room = await request(app)
      .post('/admin/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'member-room' })
      .expect(201);

    // Both agents join
    await request(app)
      .post(`/rooms/${room.body.id}/join`)
      .set('Authorization', `Bearer ${reg1.body.token}`)
      .expect(200);

    await request(app)
      .post(`/rooms/${room.body.id}/join`)
      .set('Authorization', `Bearer ${reg2.body.token}`)
      .expect(200);

    const res = await request(app)
      .get(`/rooms/${room.body.id}/members`)
      .set('Authorization', `Bearer ${reg1.body.token}`)
      .expect(200);

    expect(res.body.members).toHaveLength(2);
    expect(res.body.members[0].name).toBeDefined();
    expect(res.body.members[0].id).toBeDefined();
  });

  it('returns 404 for non-existent room', async () => {
    const reg = await request(app)
      .post('/agents')
      .send({ name: 'MemberNotFoundBot' })
      .expect(201);

    await request(app)
      .get('/rooms/non-existent-id/members')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(404);
  });
});
