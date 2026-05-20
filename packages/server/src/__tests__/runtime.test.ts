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

describe('Runtime Management', () => {
  let agentToken: string;
  let agentId: string;
  let humanCookie: string;

  beforeAll(async () => {
    ({ app, db } = createApp());
    adminToken = bootstrapDefaultAgent(db, hashToken)!;

    const reg = await request(app).post('/agents').send({ name: 'RuntimeBot' }).expect(201);
    agentToken = reg.body.token;
    agentId = reg.body.id;

    // Register a human user for humanAuth routes
    const humanRes = await request(app)
      .post('/human/register')
      .send({ username: 'test-admin', password: 'test-pass-123' })
      .expect(201);
    humanCookie = humanRes.headers['set-cookie'][0].split(';')[0];
  });

  it('registers a new runtime', async () => {
    const res = await request(app)
      .post('/runtimes')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        host: 'localhost',
        port: 9000,
        callback_url: 'http://localhost:9000',
        capabilities: ['code-review'],
        max_agents: 5,
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.host).toBe('localhost');
    expect(res.body.port).toBe(9000);
    expect(res.body.callback_url).toBe('http://localhost:9000');
    expect(res.body.status).toBe('online');
    expect(res.body.callback_secret).toBeDefined();
    expect(res.body.callback_secret.length).toBe(64); // 32 bytes hex
  });

  it('reuses the existing runtime when the same callback URL registers again', async () => {
    const first = await request(app)
      .post('/runtimes')
      .send({
        host: 'localhost',
        port: 9100,
        callback_url: 'http://localhost:9100',
        max_agents: 3,
      })
      .expect(201);

    const second = await request(app)
      .post('/runtimes')
      .send({
        host: 'localhost',
        port: 9100,
        callback_url: 'http://localhost:9100',
        max_agents: 7,
      })
      .expect(201);

    expect(second.body.id).toBe(first.body.id);
    expect(second.body.callback_secret).toBe(first.body.callback_secret);
    expect(second.body.max_agents).toBe(7);

    const list = await request(app)
      .get('/runtimes')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    const matching = list.body.runtimes.filter((runtime: { callback_url: string }) => runtime.callback_url === 'http://localhost:9100');
    expect(matching).toHaveLength(1);
  });

  it('lists registered runtimes', async () => {
    const res = await request(app)
      .get('/runtimes')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    const runtime = res.body.runtimes.find((item: { callback_url: string }) => item.callback_url === 'http://localhost:9000');
    expect(runtime).toBeDefined();
    expect(runtime.host).toBe('localhost');
    // callback_secret should NOT be in list response
    expect(runtime.callback_secret).toBeUndefined();
  });

  it('marks stale runtimes offline before listing them', async () => {
    const stale = await request(app)
      .post('/runtimes')
      .send({
        host: 'localhost',
        port: 9200,
        callback_url: 'http://localhost:9200',
        max_agents: 1,
      })
      .expect(201);

    db.prepare("UPDATE agent_runtimes SET last_heartbeat_at = datetime('now', '-2 minutes') WHERE id = ?").run(stale.body.id);

    const res = await request(app)
      .get('/runtimes')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    const runtime = res.body.runtimes.find((item: { id: string }) => item.id === stale.body.id);
    expect(runtime.status).toBe('offline');
  });

  it('rejects spawn when an explicit runtime id is stale', async () => {
    const stale = await request(app)
      .post('/runtimes')
      .send({
        host: 'localhost',
        port: 9300,
        callback_url: 'http://localhost:9300',
        max_agents: 1,
      })
      .expect(201);

    db.prepare("UPDATE agent_runtimes SET last_heartbeat_at = datetime('now', '-2 minutes') WHERE id = ?").run(stale.body.id);

    await request(app)
      .post(`/agents/${agentId}/spawn`)
      .set('Cookie', humanCookie)
      .send({ runtime_id: stale.body.id, prompt: 'should not spawn' })
      .expect(400);

    const statusRes = await request(app)
      .get(`/agents/${agentId}/status`)
      .set('Cookie', humanCookie)
      .expect(200);

    expect(statusRes.body.status).not.toBe('spawning');
    expect(statusRes.body.status).not.toBe('active');
  });

  it('updates runtime heartbeat', async () => {
    const list = await request(app)
      .get('/runtimes')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    const runtimeId = list.body.runtimes[0].id;

    const res = await request(app)
      .post(`/runtimes/${runtimeId}/heartbeat`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(res.body.status).toBe('online');
    expect(res.body.last_heartbeat_at).toBeDefined();
  });

  it('returns 404 for heartbeat on unknown runtime', async () => {
    await request(app)
      .post('/runtimes/nonexistent/heartbeat')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(404);
  });

  it('rejects registration without required fields', async () => {
    await request(app)
      .post('/runtimes')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ host: 'localhost' }) // missing port and callback_url
      .expect(400);
  });

  it('spawns agent and creates spawn record', async () => {
    const res = await request(app)
      .post(`/agents/${agentId}/spawn`)
      .set('Cookie', humanCookie)
      .send({ prompt: 'Hello world' })
      .expect(201);

    expect(res.body.spawn_id).toBeDefined();
    expect(res.body.status).toBe('spawning');

    // Agent should now be spawning
    const statusRes = await request(app)
      .get(`/agents/${agentId}/status`)
      .set('Cookie', humanCookie)
      .expect(200);

    expect(statusRes.body.status).toBe('spawning');
  });

  it('records runtime session id when an agent reports active', async () => {
    const res = await request(app)
      .post(`/agents/${agentId}/spawn`)
      .set('Cookie', humanCookie)
      .send({ prompt: 'Session id probe' })
      .expect(201);

    await request(app)
      .post(`/agents/${agentId}/activity`)
      .set('Authorization', `Bearer ${res.body.agent_token}`)
      .send({
        activity_type: 'status_change',
        detail: 'Agent active',
        metadata: { session_id: 'session-from-runtime', pid: 12345 },
      })
      .expect(201);

    const statusRes = await request(app)
      .get(`/agents/${agentId}/status`)
      .set('Cookie', humanCookie)
      .expect(200);

    expect(statusRes.body.status).toBe('active');
    expect(statusRes.body.session_id).toBe('session-from-runtime');
  });

  it('passes room context to runtime callback on spawn', async () => {
    const callbackCalls: Array<{ path: string; body: unknown }> = [];
    const callbackApp = await import('express').then(({ default: express }) => {
      const app = express();
      app.use(express.json());
      app.post('/agents/:id/callback', (req, res) => {
        callbackCalls.push({ path: req.path, body: req.body });
        res.json({ ok: true });
      });
      return app;
    });

    const callbackServer = callbackApp.listen(0);
    try {
      const address = callbackServer.address();
      if (!address || typeof address === 'string') {
        throw new Error('callback server did not bind to a TCP port');
      }
      const callbackUrl = `http://127.0.0.1:${address.port}`;

      const runtime = await request(app)
        .post('/runtimes')
        .send({
          host: '127.0.0.1',
          port: address.port,
          callback_url: callbackUrl,
          max_agents: 10,
        })
        .expect(201);

      const room = await request(app)
        .post('/rooms')
        .set('Cookie', humanCookie)
        .send({ name: 'spawn-room-context' })
        .expect(201);

      await request(app)
        .post(`/agents/${agentId}/spawn`)
        .set('Cookie', humanCookie)
        .send({ runtime_id: runtime.body.id, room_id: room.body.id })
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(callbackCalls).toHaveLength(1);
      expect(callbackCalls[0].body).toMatchObject({
        type: 'spawn',
        room_id: room.body.id,
        room_name: 'spawn-room-context',
      });
    } finally {
      await new Promise<void>((resolve) => callbackServer.close(() => resolve()));
    }
  });

  it('stops agent and marks spawn as stopped', async () => {
    const res = await request(app)
      .post(`/agents/${agentId}/stop`)
      .set('Cookie', humanCookie)
      .expect(200);

    expect(res.body.ok).toBe(true);

    // Agent should now be dormant
    const statusRes = await request(app)
      .get(`/agents/${agentId}/status`)
      .set('Cookie', humanCookie)
      .expect(200);

    expect(statusRes.body.status).toBe('dormant');
  });

  it('wakes dormant agent', async () => {
    const res = await request(app)
      .post(`/agents/${agentId}/wake`)
      .set('Cookie', humanCookie)
      .send({ prompt: 'Wake up!' })
      .expect(200);

    expect(res.body.ok).toBe(true);

    // Agent should be spawning again
    const statusRes = await request(app)
      .get(`/agents/${agentId}/status`)
      .set('Cookie', humanCookie)
      .expect(200);

    expect(statusRes.body.status).toBe('spawning');
  });

  it('returns 404 for spawn on unknown agent', async () => {
    await request(app)
      .post('/agents/nonexistent/spawn')
      .set('Cookie', humanCookie)
      .expect(404);
  });

  it('returns 404 for wake on unknown agent', async () => {
    await request(app)
      .post('/agents/nonexistent/wake')
      .set('Cookie', humanCookie)
      .expect(404);
  });
});
