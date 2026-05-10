import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../index.js';
import { bootstrapDefaultAdmin } from '../db.js';
import { hashToken } from '../middleware/auth.js';

let app: Express;
let adminToken: string;

beforeAll(() => {
  const result = createApp();
  app = result.app;
  adminToken = bootstrapDefaultAdmin(result.db, hashToken)!;
});

describe('End-to-end: Register → Room → Message → Mention → Reaction → Thread', () => {
  let agentA: { id: string; token: string };
  let agentB: { id: string; token: string };
  let roomId: string;

  it('Step 1: Agent A registers', async () => {
    const res = await request(app)
      .post('/agents')
      .send({ name: 'CodeReviewer', capabilities: ['code-review'], model: 'claude-opus-4-7' })
      .expect(201);

    agentA = { id: res.body.id, token: res.body.token };
    expect(res.body.name).toBe('CodeReviewer');
  });

  it('Step 2: Agent B registers', async () => {
    const res = await request(app)
      .post('/agents')
      .send({ name: 'DataAnalyst', capabilities: ['data-analysis'] })
      .expect(201);

    agentB = { id: res.body.id, token: res.body.token };
  });

  it('Step 3: Admin creates a room', async () => {
    const res = await request(app)
      .post('/admin/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'auth-review', description: 'Discuss auth module refactor' })
      .expect(201);

    roomId = res.body.id;
  });

  it('Step 4: Agent B joins the room', async () => {
    await request(app)
      .post(`/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${agentB.token}`)
      .expect(200);
  });

  it('Step 5: Agent A sends a message mentioning Agent B', async () => {
    // Agent A also needs to be in the room
    await request(app)
      .post(`/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${agentA.token}`)
      .expect(200);

    const res = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${agentA.token}`)
      .send({
        room_id: roomId,
        content: 'Found 3 issues in the auth module. @DataAnalyst can you check query performance?',
        mentions: [agentB.id],
        idempotency_key: 'e2e-msg-1',
      })
      .expect(201);

    expect(res.body.sequence).toBe(1);
  });

  it('Step 6: Agent B reacts to Agent A\'s message', async () => {
    const msgs = await request(app)
      .get(`/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${agentA.token}`)
      .expect(200);

    const msgId = msgs.body.messages[0].id;

    const res = await request(app)
      .post(`/messages/${msgId}/reactions`)
      .set('Authorization', `Bearer ${agentB.token}`)
      .send({ type: 'useful' })
      .expect(201);

    expect(res.body.type).toBe('useful');
  });

  it('Step 7: Agent B replies in a thread', async () => {
    const msgs = await request(app)
      .get(`/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${agentA.token}`)
      .expect(200);

    const parentId = msgs.body.messages[0].id;

    const res = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${agentB.token}`)
      .send({
        room_id: roomId,
        content: 'Query performance looks good, but index on user_id is missing.',
        reply_to: parentId,
        idempotency_key: 'e2e-msg-2',
      })
      .expect(201);

    expect(res.body.sequence).toBe(2);
  });

  it('Step 8: Thread view shows both messages', async () => {
    const msgs = await request(app)
      .get(`/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${agentA.token}`)
      .expect(200);

    const parentId = msgs.body.messages[1].id;

    const thread = await request(app)
      .get(`/messages/${parentId}/thread`)
      .set('Authorization', `Bearer ${agentA.token}`)
      .expect(200);

    expect(thread.body.messages).toHaveLength(2);
    expect(thread.body.messages[0].content).toContain('Found 3 issues');
    expect(thread.body.messages[1].content).toContain('Query performance');
  });

  it('Step 9: Message reactions are included in message list', async () => {
    const msgs = await request(app)
      .get(`/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${agentA.token}`)
      .expect(200);

    const firstMsg = msgs.body.messages[1];
    expect(firstMsg.reactions).toHaveLength(1);
    expect(firstMsg.reactions[0].type).toBe('useful');
    expect(firstMsg.reactions[0].count).toBe(1);
  });

  it('Step 10: Agent search finds registered agents', async () => {
    const res = await request(app)
      .get('/agents?q=Code&capabilities=code-review')
      .set('Authorization', `Bearer ${agentA.token}`)
      .expect(200);

    expect(res.body.agents).toHaveLength(1);
    expect(res.body.agents[0].name).toBe('CodeReviewer');
  });
});
