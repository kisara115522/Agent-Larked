import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { createApp } from '../index.js';
import { bootstrapDefaultAgent } from '../db.js';
import { hashToken } from '../middleware/auth.js';

let app: Express;
let db: Database.Database;

describe('Configs & Token Budgets API', () => {
  let agentToken: string;

  beforeAll(async () => {
    ({ app, db } = createApp());
    bootstrapDefaultAgent(db, hashToken);

    const reg = await request(app).post('/agents').send({ name: 'ConfigBot' }).expect(201);
    agentToken = reg.body.token;
  });

  it('gets token budget (defaults when none set)', async () => {
    const res = await request(app)
      .get('/token-budgets')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(res.body.daily_limit).toBe(100000);
    expect(res.body.monthly_limit).toBe(3000000);
    expect(res.body.current_daily).toBe(0);
  });

  it('gets token usage (empty initially)', async () => {
    const res = await request(app)
      .get('/token-usage')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(res.body.usage).toEqual([]);
  });

  it('gets configs (empty initially)', async () => {
    const res = await request(app)
      .get('/configs')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(res.body.agent_configs).toEqual([]);
    expect(res.body.global_configs).toEqual([]);
  });

  it('updates agent config', async () => {
    await request(app)
      .patch('/configs')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ config_type: 'model', config_value: 'claude-sonnet-4-6' })
      .expect(200);

    const res = await request(app)
      .get('/configs')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(res.body.agent_configs).toHaveLength(1);
    expect(res.body.agent_configs[0].config_type).toBe('model');
    expect(res.body.agent_configs[0].config_value).toBe('claude-sonnet-4-6');
  });
});
