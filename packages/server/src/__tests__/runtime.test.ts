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

  beforeAll(async () => {
    ({ app, db } = createApp());
    adminToken = bootstrapDefaultAgent(db, hashToken)!;

    const reg = await request(app).post('/agents').send({ name: 'RuntimeBot' }).expect(201);
    agentToken = reg.body.token;
    agentId = reg.body.id;
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

  it('lists registered runtimes', async () => {
    const res = await request(app)
      .get('/runtimes')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(res.body.runtimes).toHaveLength(1);
    expect(res.body.runtimes[0].host).toBe('localhost');
    // callback_secret should NOT be in list response
    expect(res.body.runtimes[0].callback_secret).toBeUndefined();
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
});
