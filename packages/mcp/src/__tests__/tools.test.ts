import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDatabase } from '@flock/server/db';
import { registerIdentityTools } from '../tools/identity.js';
import { registerRoomTools } from '../tools/room.js';
import { resetAgentCache, resolveAgentId } from '../db.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
let client: Client;

beforeAll(async () => {
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
