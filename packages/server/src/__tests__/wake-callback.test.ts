import express from 'express';
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../index.js';
import { hashToken } from '../middleware/auth.js';
import { bootstrapDefaultAgent } from '../db.js';

describe('automatic wake callbacks', () => {
  it('wakes a mentioned dormant agent with identity, token, provider config, and room context', async () => {
    const { app, db } = createApp();
    const adminToken = bootstrapDefaultAgent(db, hashToken)!;
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

      const mentioned = await request(app).post('/agents').send({ name: 'MentionWakeBot' }).expect(201);
      const sender = await request(app).post('/agents').send({ name: 'MentionSender' }).expect(201);
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
        .patch('/configs')
        .set('Authorization', `Bearer ${mentioned.body.token}`)
        .send({ config_type: 'model', config_value: 'sonnet' })
        .expect(200);
      await request(app)
        .patch('/configs')
        .set('Authorization', `Bearer ${mentioned.body.token}`)
        .send({ config_type: 'provider', config_value: { name: 'custom', env: { ANTHROPIC_BASE_URL: 'https://provider.test' } } })
        .expect(200);

      const room = await request(app)
        .post('/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'mention-wake-room' })
        .expect(201);
      await request(app).post(`/rooms/${room.body.id}/join`).set('Authorization', `Bearer ${sender.body.token}`).expect(200);
      await request(app).post(`/rooms/${room.body.id}/join`).set('Authorization', `Bearer ${mentioned.body.token}`).expect(200);

      db.prepare("UPDATE profiles SET status = 'dormant' WHERE id = ?").run(mentioned.body.id);
      db.prepare(`
        INSERT INTO agent_spawns (id, agent_id, runtime_id, status, spawned_at, last_active_at, prompt)
        VALUES ('mention-wake-previous-spawn', ?, ?, 'stopped', ?, ?, 'previous spawn')
      `).run(mentioned.body.id, runtime.body.id, new Date().toISOString(), new Date().toISOString());

      await request(app)
        .post('/messages')
        .set('Authorization', `Bearer ${sender.body.token}`)
        .send({
          room_id: room.body.id,
          content: '@MentionWakeBot please use the room context',
          mentions: [mentioned.body.id],
          idempotency_key: 'mention-wake-context',
        })
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(callbackCalls).toHaveLength(1);
      expect(callbackCalls[0].body).toMatchObject({
        type: 'wake',
        trigger_type: 'mention',
        agent_name: 'MentionWakeBot',
        agent_model: 'sonnet',
        room_id: room.body.id,
        room_name: 'mention-wake-room',
      });
      expect(callbackCalls[0].body.agent_token).toEqual(expect.any(String));
      expect(callbackCalls[0].body.agent_provider).toMatchObject({ name: 'custom' });
      expect(String(callbackCalls[0].body.prompt)).toContain('@MentionWakeBot please use the room context');

      const activeSpawn = db.prepare(`
        SELECT status, prompt FROM agent_spawns
        WHERE agent_id = ? AND runtime_id = ?
        ORDER BY spawned_at DESC
        LIMIT 1
      `).get(mentioned.body.id, runtime.body.id) as { status: string; prompt: string };
      expect(activeSpawn.status).toBe('spawning');
      expect(activeSpawn.prompt).toContain('mention-wake-room');

      await request(app)
        .post(`/agents/${mentioned.body.id}/activity`)
        .set('Authorization', `Bearer ${callbackCalls[0].body.agent_token}`)
        .send({ activity_type: 'status_change', detail: 'Agent active', metadata: { session_id: 'mention-session' } })
        .expect(201);
    } finally {
      await new Promise<void>((resolve) => callbackServer.close(() => resolve()));
    }
  });

  it('falls back to an available runtime when the mentioned agent last ran on an offline runtime', async () => {
    const { app, db } = createApp();
    const adminToken = bootstrapDefaultAgent(db, hashToken)!;
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

      const mentioned = await request(app).post('/agents').send({ name: 'FallbackMentionBot' }).expect(201);
      const sender = await request(app).post('/agents').send({ name: 'FallbackSender' }).expect(201);
      const offlineRuntime = await request(app)
        .post('/runtimes')
        .send({
          host: '127.0.0.1',
          port: 1,
          callback_url: 'http://127.0.0.1:1',
          max_agents: 10,
        })
        .expect(201);
      const onlineRuntime = await request(app)
        .post('/runtimes')
        .send({
          host: '127.0.0.1',
          port: address.port,
          callback_url: `http://127.0.0.1:${address.port}`,
          max_agents: 10,
        })
        .expect(201);

      const room = await request(app)
        .post('/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'mention-fallback-room' })
        .expect(201);
      await request(app).post(`/rooms/${room.body.id}/join`).set('Authorization', `Bearer ${sender.body.token}`).expect(200);
      await request(app).post(`/rooms/${room.body.id}/join`).set('Authorization', `Bearer ${mentioned.body.token}`).expect(200);

      db.prepare("UPDATE agent_runtimes SET status = 'offline' WHERE id = ?").run(offlineRuntime.body.id);
      db.prepare("UPDATE profiles SET status = 'spawning' WHERE id = ?").run(mentioned.body.id);
      const staleSpawnTime = new Date(Date.now() - 60_000).toISOString();
      db.prepare(`
        INSERT INTO agent_spawns (id, agent_id, runtime_id, status, spawned_at, last_active_at, prompt)
        VALUES ('mention-fallback-stuck-spawn', ?, ?, 'spawning', ?, ?, 'stuck spawn')
      `).run(mentioned.body.id, offlineRuntime.body.id, staleSpawnTime, staleSpawnTime);

      await request(app)
        .post('/messages')
        .set('Authorization', `Bearer ${sender.body.token}`)
        .send({
          room_id: room.body.id,
          content: '@FallbackMentionBot please recover on an online runtime',
          mentions: [mentioned.body.id],
          idempotency_key: 'mention-fallback-runtime',
        })
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(callbackCalls).toHaveLength(1);
      expect(callbackCalls[0].body).toMatchObject({
        type: 'wake',
        trigger_type: 'mention',
        agent_name: 'FallbackMentionBot',
        room_id: room.body.id,
      });

      const latestSpawn = db.prepare(`
        SELECT runtime_id, status
        FROM agent_spawns
        WHERE agent_id = ?
        ORDER BY spawned_at DESC
        LIMIT 1
      `).get(mentioned.body.id) as { runtime_id: string; status: string };
      expect(latestSpawn.runtime_id).toBe(onlineRuntime.body.id);
      expect(latestSpawn.status).toBe('spawning');
    } finally {
      await new Promise<void>((resolve) => callbackServer.close(() => resolve()));
    }
  });

  it('falls back to an available runtime when the mentioned agent last ran on a stale online runtime', async () => {
    const { app, db } = createApp();
    const adminToken = bootstrapDefaultAgent(db, hashToken)!;
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

      const mentioned = await request(app).post('/agents').send({ name: 'StaleMentionBot' }).expect(201);
      const sender = await request(app).post('/agents').send({ name: 'StaleSender' }).expect(201);
      const staleRuntime = await request(app)
        .post('/runtimes')
        .send({
          host: '127.0.0.1',
          port: 1,
          callback_url: 'http://127.0.0.1:1',
          max_agents: 10,
        })
        .expect(201);
      const onlineRuntime = await request(app)
        .post('/runtimes')
        .send({
          host: '127.0.0.1',
          port: address.port,
          callback_url: `http://127.0.0.1:${address.port}`,
          max_agents: 10,
        })
        .expect(201);

      const room = await request(app)
        .post('/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'mention-stale-runtime-room' })
        .expect(201);
      await request(app).post(`/rooms/${room.body.id}/join`).set('Authorization', `Bearer ${sender.body.token}`).expect(200);
      await request(app).post(`/rooms/${room.body.id}/join`).set('Authorization', `Bearer ${mentioned.body.token}`).expect(200);

      const staleHeartbeat = new Date(Date.now() - 120_000).toISOString();
      const staleSpawnTime = new Date(Date.now() - 60_000).toISOString();
      db.prepare("UPDATE agent_runtimes SET status = 'online', last_heartbeat_at = ? WHERE id = ?").run(staleHeartbeat, staleRuntime.body.id);
      db.prepare("UPDATE profiles SET status = 'spawning' WHERE id = ?").run(mentioned.body.id);
      db.prepare(`
        INSERT INTO agent_spawns (id, agent_id, runtime_id, status, spawned_at, last_active_at, prompt)
        VALUES ('mention-stale-stuck-spawn', ?, ?, 'spawning', ?, ?, 'stuck spawn')
      `).run(mentioned.body.id, staleRuntime.body.id, staleSpawnTime, staleSpawnTime);

      await request(app)
        .post('/messages')
        .set('Authorization', `Bearer ${sender.body.token}`)
        .send({
          room_id: room.body.id,
          content: '@StaleMentionBot please recover from a stale runtime',
          mentions: [mentioned.body.id],
          idempotency_key: 'mention-stale-runtime',
        })
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(callbackCalls).toHaveLength(1);
      expect(callbackCalls[0].body).toMatchObject({
        type: 'wake',
        trigger_type: 'mention',
        agent_name: 'StaleMentionBot',
        room_id: room.body.id,
      });

      const latestSpawn = db.prepare(`
        SELECT runtime_id, status
        FROM agent_spawns
        WHERE agent_id = ?
        ORDER BY spawned_at DESC
        LIMIT 1
      `).get(mentioned.body.id) as { runtime_id: string; status: string };
      expect(latestSpawn.runtime_id).toBe(onlineRuntime.body.id);
      expect(latestSpawn.status).toBe('spawning');
    } finally {
      await new Promise<void>((resolve) => callbackServer.close(() => resolve()));
    }
  });
});
