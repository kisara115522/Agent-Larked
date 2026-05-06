import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDatabase } from '@flock/server/db';
import { registerIdentityTools } from '../tools/identity.js';
import { registerRoomTools } from '../tools/room.js';
import { registerMessagingTools } from '../tools/messaging.js';
import { registerResources } from '../resources.js';
import { resetAgentCache, resolveAgentId } from '../db.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
let client: Client;
let roomId: string;

beforeAll(async () => {
  db = createDatabase(':memory:');
  const server = new McpServer({ name: 'test-flock-resources', version: '0.1.0' });
  registerIdentityTools(server, db);
  registerRoomTools(server, db);
  registerMessagingTools(server, db);
  registerResources(server, db);

  client = new Client({ name: 'test-client', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  // Setup: register agent, create room, send message
  resetAgentCache();
  await client.callTool({
    name: 'flock_register',
    arguments: { name: 'ResourceBot' },
  });
  resolveAgentId(db, 'ResourceBot');

  const roomResult = await client.callTool({
    name: 'flock_room_create',
    arguments: { name: 'resource-room', description: 'For resource testing' },
  });
  roomId = JSON.parse((roomResult.content as Array<{ type: string; text: string }>)[0].text).id;

  await client.callTool({
    name: 'flock_post',
    arguments: { room_id: roomId, content: 'Resource test message' },
  });
});

afterAll(async () => {
  await client.close();
  db.close();
});

function getTextContent(result: { contents: Array<{ text?: string; blob?: string }> }): string {
  const content = result.contents[0];
  if ('text' in content && content.text) return content.text;
  throw new Error('No text content in resource');
}

describe('flock://agents resource', () => {
  it('lists registered agents', async () => {
    const result = await client.readResource({ uri: 'flock://agents' });
    expect(result.contents.length).toBeGreaterThan(0);
    const agents = JSON.parse(getTextContent(result));
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThanOrEqual(1);
    expect(agents[0].name).toBeDefined();
  });
});

describe('flock://rooms resource', () => {
  it('lists all rooms', async () => {
    const result = await client.readResource({ uri: 'flock://rooms' });
    expect(result.contents.length).toBeGreaterThan(0);
    const rooms = JSON.parse(getTextContent(result));
    expect(Array.isArray(rooms)).toBe(true);
    expect(rooms.length).toBeGreaterThanOrEqual(1);
    expect(rooms[0].name).toBeDefined();
  });
});

describe('flock://rooms/{room_id}/messages resource', () => {
  it('reads messages from a specific room', async () => {
    const result = await client.readResource({ uri: `flock://rooms/${roomId}/messages` });
    expect(result.contents.length).toBeGreaterThan(0);
    const messages = JSON.parse(getTextContent(result));
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].content).toBe('Resource test message');
  });
});
