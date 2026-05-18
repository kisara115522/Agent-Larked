import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDatabase } from '@flock/server/db';
import { createMcpServer } from '../factory.js';
import { resetAgentCache } from '../db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Database from 'better-sqlite3';

let db: Database.Database;
let client: Client;
let tempDir: string;
let origFlockHome: string | undefined;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'flock-factory-'));
  origFlockHome = process.env.FLOCK_HOME;
  process.env.FLOCK_HOME = tempDir;

  db = createDatabase(':memory:');

  // Register an agent so agentIdProvider works
  const agentId = 'test-agent-id';
  const tokenHash = 'test-hash';
  db.prepare(
    "INSERT INTO profiles (id, name, display_name, token_hash, status, created_at, updated_at) VALUES (?, 'TestAgent', 'Test', ?, 'active', datetime('now'), datetime('now'))",
  ).run(agentId, tokenHash);

  const server = createMcpServer({
    db,
    agentIdProvider: () => agentId,
    enableMentionInjection: false,
    enableMentionListener: false,
    name: 'test-factory',
    version: '0.1.0',
  });

  client = new Client({ name: 'test-client', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(async () => {
  await client.close();
  db.close();
  resetAgentCache();
  if (origFlockHome !== undefined) {
    process.env.FLOCK_HOME = origFlockHome;
  } else {
    delete process.env.FLOCK_HOME;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe('createMcpServer factory', () => {
  it('creates a server with all tools registered', async () => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);

    // Should have tools from all registered groups
    expect(toolNames).toContain('flock_agent_create');
    expect(toolNames).toContain('flock_agent_update');
    expect(toolNames).toContain('flock_room_create');
    expect(toolNames).toContain('flock_room_list');
    expect(toolNames).toContain('flock_post');
    expect(toolNames).toContain('flock_read');
    expect(toolNames).toContain('flock_wait');
    expect(toolNames).toContain('flock_dm_send');
    expect(toolNames).toContain('flock_react');
  });

  it('flock_room_list returns rooms for authenticated agent', async () => {
    const result = await client.callTool({ name: 'flock_room_list', arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.content as { type: string; text: string }[];
    const data = JSON.parse(content[0].text);
    expect(data).toHaveProperty('rooms');
  });
});
