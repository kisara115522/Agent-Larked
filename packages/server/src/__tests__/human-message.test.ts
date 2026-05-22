import express from 'express';
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { createApp } from '../index.js';
import { bootstrapDefaultAgent } from '../db.js';
import { hashToken } from '../middleware/auth.js';

async function waitForCallback(callbackCalls: unknown[], expected = 1, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (callbackCalls.length < expected && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

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
    expect(humanMsg.from_name).toBe('testhuman');
    expect(humanMsg.from_display_name).toBe('Test Human');
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

  it('human room messages can mention and wake a dormant agent', async () => {
    const callbackCalls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const callbackApp = express();
    callbackApp.use(express.json());
    callbackApp.post('/agents/:id/callback', (req, res) => {
      callbackCalls.push({ path: req.path, body: req.body });
      res.json({ ok: true });
    });

    const callbackServer = callbackApp.listen(0);
    try {
      const address = callbackServer.address();
      if (!address || typeof address === 'string') {
        throw new Error('callback server did not bind to a TCP port');
      }

      const mentioned = await request(app).post('/agents').send({ name: 'HumanMentionWakeBot' }).expect(201);
      const runtime = await request(app)
        .post('/runtimes')
        .send({
          host: '127.0.0.1',
          port: address.port,
          callback_url: `http://127.0.0.1:${address.port}`,
          max_agents: 10,
        })
        .expect(201);

      await request(app)
        .post(`/rooms/${roomId}/join`)
        .set('Authorization', `Bearer ${mentioned.body.token}`)
        .expect(200);

      db.prepare("UPDATE profiles SET status = 'dormant' WHERE id = ?").run(mentioned.body.id);
      db.prepare(`
        INSERT INTO agent_spawns (id, agent_id, runtime_id, status, spawned_at, last_active_at, prompt)
        VALUES ('human-mention-wake-previous-spawn', ?, ?, 'stopped', ?, ?, 'previous spawn')
      `).run(mentioned.body.id, runtime.body.id, new Date().toISOString(), new Date().toISOString());

      await request(app)
        .post(`/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${humanToken}`)
        .send({
          content: '@HumanMentionWakeBot please join the room thread',
          mentions: [mentioned.body.id],
        })
        .expect(201);

      await waitForCallback(callbackCalls);

      expect(callbackCalls).toHaveLength(1);
      expect(callbackCalls[0].body).toMatchObject({
        type: 'wake',
        trigger_type: 'mention',
        room_id: roomId,
        sender_name: 'Test Human',
      });
      expect(callbackCalls[0].body.agent_token).toEqual(expect.any(String));
      expect(String(callbackCalls[0].body.prompt)).toContain('@HumanMentionWakeBot please join the room thread');

      const history = await request(app)
        .get(`/agents/${mentioned.body.id}/wake-history?limit=5`)
        .set('Authorization', `Bearer ${humanToken}`)
        .expect(200);

      const mentionWake = history.body.events.find((event: { trigger_type: string }) => event.trigger_type === 'mention');
      expect(mentionWake).toMatchObject({
        triggered_by_name: 'Test Human',
        room_id: roomId,
        status: 'sent',
      });
    } finally {
      await new Promise<void>((resolve) => callbackServer.close(() => resolve()));
    }
  });
});
