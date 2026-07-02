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
  let agentId: string;
  let humanToken: string;

  beforeAll(async () => {
    ({ app, db } = createApp());
    bootstrapDefaultAgent(db, hashToken);

    const reg = await request(app).post('/agents').send({ name: 'ConfigBot' }).expect(201);
    agentToken = reg.body.token;
    agentId = reg.body.id;

    const human = await request(app)
      .post('/human/register')
      .send({ username: 'config-admin', password: 'test-pass-123' })
      .expect(201);
    humanToken = human.body.token;
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

  it('lets a human manage a target agent provider config', async () => {
    const provider = {
      name: 'xiavier',
      env: {
        ANTHROPIC_BASE_URL: 'https://www.xiavier.com',
        ANTHROPIC_AUTH_TOKEN: 'token-from-provider',
      },
    };

    await request(app)
      .patch('/configs')
      .set('Authorization', `Bearer ${humanToken}`)
      .send({ agent_id: agentId, config_type: 'provider', config_value: provider })
      .expect(200);

    const res = await request(app)
      .get(`/configs?agent_id=${agentId}`)
      .set('Authorization', `Bearer ${humanToken}`)
      .expect(200);

    expect(res.body.agent_configs).toContainEqual({
      config_type: 'provider',
      config_value: provider,
      is_global: false,
    });
  });

  it('does not let an agent update another agent config', async () => {
    const other = await request(app).post('/agents').send({ name: 'ConfigOther' }).expect(201);

    await request(app)
      .patch('/configs')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ agent_id: other.body.id, config_type: 'provider', config_value: 'default' })
      .expect(403);
  });

  it('lets a human write global mcp config', async () => {
    const mcp = {
      mcpServers: {
        echo: { type: 'stdio', command: 'echo', args: ['hi'] },
      },
    };

    await request(app)
      .patch('/configs/global')
      .set('Authorization', `Bearer ${humanToken}`)
      .send({ config_type: 'mcp', config_value: mcp })
      .expect(200);

    const res = await request(app)
      .get('/configs')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(res.body.global_configs).toContainEqual({
      config_type: 'mcp',
      config_value: mcp,
    });
  });

  it('rejects agent tokens writing global config', async () => {
    await request(app)
      .patch('/configs/global')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ config_type: 'mcp', config_value: { mcpServers: {} } })
      .expect(403);
  });

  it('rejects invalid config_type on global patch', async () => {
    await request(app)
      .patch('/configs/global')
      .set('Authorization', `Bearer ${humanToken}`)
      .send({ config_type: 'model', config_value: 'x' })
      .expect(400);
  });

  it('upserts global config (last write wins per type)', async () => {
    await request(app)
      .patch('/configs/global')
      .set('Authorization', `Bearer ${humanToken}`)
      .send({ config_type: 'skills', config_value: [{ name: 'a', description: '', body: '' }] })
      .expect(200);
    await request(app)
      .patch('/configs/global')
      .set('Authorization', `Bearer ${humanToken}`)
      .send({ config_type: 'skills', config_value: [{ name: 'b', description: '', body: '' }] })
      .expect(200);
    const res = await request(app).get('/configs').set('Authorization', `Bearer ${humanToken}`).expect(200);
    const skills = res.body.global_configs.find((c: { config_type: string }) => c.config_type === 'skills');
    expect(skills.config_value).toEqual([{ name: 'b', description: '', body: '' }]);
  });
});
