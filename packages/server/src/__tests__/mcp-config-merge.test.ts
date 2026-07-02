import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { createApp } from '../index.js';
import { bootstrapDefaultAgent } from '../db.js';
import { hashToken } from '../middleware/auth.js';

describe('per-agent MCP config merge', () => {
  let app: Express;
  let db: Database.Database;
  let humanToken: string;
  let agentToken: string;
  let agentId: string;
  const savedEnv = process.env.FLOCK_PER_AGENT_MCP;

  beforeEach(async () => {
    process.env.FLOCK_PER_AGENT_MCP = '1';
    ({ app, db } = createApp());
    bootstrapDefaultAgent(db, hashToken);

    const reg = await request(app).post('/agents').send({ name: 'McpBot' }).expect(201);
    agentToken = reg.body.token;
    agentId = reg.body.id;

    const human = await request(app).post('/human/register')
      .send({ username: 'mcp-admin', password: 'test-pass-123' }).expect(201);
    humanToken = human.body.token;
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.FLOCK_PER_AGENT_MCP;
    else process.env.FLOCK_PER_AGENT_MCP = savedEnv;
  });

  it('agent same-name overrides global; unique names union', async () => {
    await request(app).patch('/configs/global').set('Authorization', `Bearer ${humanToken}`)
      .send({ config_type: 'mcp', config_value: { mcpServers: {
        shared: { type: 'stdio', command: 'globalCmd' },
        globalOnly: { type: 'stdio', command: 'g' },
      } } }).expect(200);

    await request(app).patch('/configs').set('Authorization', `Bearer ${agentToken}`)
      .send({ config_type: 'mcp', config_value: { mcpServers: {
        shared: { type: 'stdio', command: 'agentCmd' },
        agentOnly: { type: 'stdio', command: 'a' },
      } } }).expect(200);

    const { getAgentRuntimeConfigForTests } = await import('../services/callback.js');
    const config = getAgentRuntimeConfigForTests(db, agentId);
    const names = Object.fromEntries((config.mcpServers ?? []).map(s => [s.name, s.transport]));
    expect(names.shared).toMatchObject({ type: 'stdio', command: 'agentCmd' });
    expect(names.globalOnly).toMatchObject({ command: 'g' });
    expect(names.agentOnly).toMatchObject({ command: 'a' });
  });

  it("drops reserved name 'flock'", async () => {
    await request(app).patch('/configs').set('Authorization', `Bearer ${agentToken}`)
      .send({ config_type: 'mcp', config_value: { mcpServers: {
        flock: { type: 'stdio', command: 'evil' },
        other: { type: 'stdio', command: 'ok' },
      } } }).expect(200);

    const { getAgentRuntimeConfigForTests } = await import('../services/callback.js');
    const config = getAgentRuntimeConfigForTests(db, agentId);
    const names = (config.mcpServers ?? []).map(s => s.name);
    expect(names).not.toContain('flock');
    expect(names).toContain('other');
  });

  it('returns undefined mcpServers when flag off', async () => {
    delete process.env.FLOCK_PER_AGENT_MCP;
    await request(app).patch('/configs').set('Authorization', `Bearer ${agentToken}`)
      .send({ config_type: 'mcp', config_value: { mcpServers: { x: { type: 'stdio', command: 'c' } } } }).expect(200);

    const { getAgentRuntimeConfigForTests } = await import('../services/callback.js');
    const config = getAgentRuntimeConfigForTests(db, agentId);
    expect(config.mcpServers).toBeUndefined();
  });

  it('drops invalid transports silently', async () => {
    await request(app).patch('/configs').set('Authorization', `Bearer ${agentToken}`)
      .send({ config_type: 'mcp', config_value: { mcpServers: {
        good: { type: 'stdio', command: 'ok' },
        badNoCommand: { type: 'stdio' },
        badUnknown: { type: 'weird' },
      } } }).expect(200);
    const { getAgentRuntimeConfigForTests } = await import('../services/callback.js');
    const config = getAgentRuntimeConfigForTests(db, agentId);
    const names = (config.mcpServers ?? []).map(s => s.name);
    expect(names).toEqual(['good']);
  });
});
