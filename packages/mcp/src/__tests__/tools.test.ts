import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDatabase } from '@flock/server/db';
import { registerIdentityTools } from '../tools/identity.js';
import { registerRoomTools } from '../tools/room.js';
import { resetAgentCache, resolveAgentId } from '../db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Database from 'better-sqlite3';

let db: Database.Database;
let client: Client;
let tempDir: string;
let origFlockHome: string | undefined;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'flock-tools-'));
  origFlockHome = process.env.FLOCK_HOME;
  process.env.FLOCK_HOME = tempDir;

  db = createDatabase(':memory:');
  const server = new McpServer({ name: 'test-flock', version: '0.1.0' });
  registerIdentityTools(server, db);
  registerRoomTools(server, db);

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
  if (origFlockHome !== undefined) {
    process.env.FLOCK_HOME = origFlockHome;
  } else {
    delete process.env.FLOCK_HOME;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe('flock_register tool', () => {
  it('registers a new agent', async () => {
    const result = await client.callTool({
      name: 'flock_register',
      arguments: { name: 'MCPTestBot', bio: 'I test MCP', capabilities: ['testing'] },
    });

    expect(result.content).toHaveLength(1);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.name).toBe('MCPTestBot');
    expect(parsed.id).toBeDefined();
    expect(parsed.token).toBeDefined();
    expect(parsed.token).toHaveLength(64);
  });

  it('rejects duplicate agent name', async () => {
    const result = await client.callTool({
      name: 'flock_register',
      arguments: { name: 'MCPTestBot' },
    });

    expect(result.isError).toBe(true);
  });
});

describe('flock_discover tool', () => {
  it('finds registered agents', async () => {
    await client.callTool({
      name: 'flock_register',
      arguments: { name: 'DiscoverBot', capabilities: ['code-review'] },
    });

    const result = await client.callTool({
      name: 'flock_discover',
      arguments: { q: 'Discover' },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.agents.length).toBeGreaterThanOrEqual(1);
    expect(parsed.agents.some((a: { name: string }) => a.name === 'DiscoverBot')).toBe(true);
  });
});

describe('flock_room_create tool', () => {
  it('creates a room when agent is registered', async () => {
    resetAgentCache();
    await client.callTool({
      name: 'flock_register',
      arguments: { name: 'RoomCreatorBot' },
    });
    resolveAgentId(db, 'RoomCreatorBot');

    const result = await client.callTool({
      name: 'flock_room_create',
      arguments: { name: 'mcp-test-room', description: 'Created via MCP' },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.name).toBe('mcp-test-room');
    expect(parsed.id).toBeDefined();
  });
});

describe('flock_room_list tool', () => {
  it('lists rooms', async () => {
    const result = await client.callTool({
      name: 'flock_room_list',
      arguments: {},
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.rooms).toBeDefined();
    expect(Array.isArray(parsed.rooms)).toBe(true);
    expect(parsed.rooms.length).toBeGreaterThanOrEqual(1);
  });
});

describe('flock_update with display_name', () => {
  it('sets display_name', async () => {
    resetAgentCache();
    await client.callTool({
      name: 'flock_register',
      arguments: { name: 'DisplayNameBot' },
    });
    resolveAgentId(db, 'DisplayNameBot');

    const result = await client.callTool({
      name: 'flock_update',
      arguments: { display_name: 'The Display Bot', status: 'online' },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.display_name).toBe('The Display Bot');
    expect(parsed.status).toBe('active');
  });
});
