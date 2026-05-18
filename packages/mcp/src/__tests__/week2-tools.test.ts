import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDatabase } from '@flock/server/db';
import { registerIdentityTools } from '../tools/identity.js';
import { registerRoomTools } from '../tools/room.js';
import { registerMessagingTools } from '../tools/messaging.js';
import { registerReactionTools } from '../tools/reactions.js';
import { registerWaitTool, emitNewMessage } from '../tools/subscribe.js';
import { resetAgentCache, resolveAgentId } from '../db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Database from 'better-sqlite3';

let db: Database.Database;
let client: Client;
let agentId: string;
let roomId: string;
let tempDir: string;
let origFlockHome: string | undefined;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'flock-week2-'));
  origFlockHome = process.env.FLOCK_HOME;
  process.env.FLOCK_HOME = tempDir;

  db = createDatabase(':memory:');
  const server = new McpServer({ name: 'test-flock-week2', version: '0.1.0' });
  registerIdentityTools(server, db);
  registerRoomTools(server, db);
  registerMessagingTools(server, db);
  registerReactionTools(server, db);
  registerWaitTool(server, db);

  client = new Client({ name: 'test-client', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  // Register an agent and create a room for tests
  resetAgentCache();
  const regResult = await client.callTool({
    name: 'flock_agent_create',
    arguments: { name: 'Week2Bot', capabilities: ['testing'] },
  });
  const regText = (regResult.content as Array<{ type: string; text: string }>)[0].text;
  const reg = JSON.parse(regText);
  agentId = reg.id;
  resolveAgentId(db, 'Week2Bot');

  const roomResult = await client.callTool({
    name: 'flock_room_create',
    arguments: { name: 'week2-test-room', description: 'Week 2 testing' },
  });
  const roomText = (roomResult.content as Array<{ type: string; text: string }>)[0].text;
  roomId = JSON.parse(roomText).id;
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

describe('flock_post tool', () => {
  it('sends a message to a room', async () => {
    const result = await client.callTool({
      name: 'flock_post',
      arguments: { room_id: roomId, content: 'Hello from MCP!' },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.id).toBeDefined();
    expect(parsed.sequence).toBe(1);
    expect(parsed.created_at).toBeDefined();
  });

  it('sends a message with mentions', async () => {
    // Register another agent to mention
    const regResult = await client.callTool({
      name: 'flock_agent_create',
      arguments: { name: 'MentionBot' },
    });
    const mentionedId = JSON.parse((regResult.content as Array<{ type: string; text: string }>)[0].text).id;

    // Join the mentioned agent to the room
    resetAgentCache();
    resolveAgentId(db, 'MentionBot');
    await client.callTool({ name: 'flock_room_join', arguments: { room_id: roomId } });

    // Switch back to original agent
    resetAgentCache();
    resolveAgentId(db, 'Week2Bot');

    const result = await client.callTool({
      name: 'flock_post',
      arguments: { room_id: roomId, content: 'Hey @MentionBot!', mentions: [mentionedId] },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.id).toBeDefined();
    expect(parsed.sequence).toBe(2);
  });

  it('fails when agent cache is empty', async () => {
    resetAgentCache();
    delete process.env.AGENT_ID;

    const result = await client.callTool({
      name: 'flock_post',
      arguments: { room_id: roomId, content: 'Should fail' },
    });

    expect(result.isError).toBe(true);

    // Restore
    resolveAgentId(db, 'Week2Bot');
  });
});

describe('flock_read tool', () => {
  it('reads messages from a room', async () => {
    const result = await client.callTool({
      name: 'flock_read',
      arguments: { room_id: roomId, limit: 10 },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.messages).toBeDefined();
    expect(parsed.messages.length).toBeGreaterThanOrEqual(2);
    expect(parsed.messages[0].content).toBeDefined();
  });
});

describe('flock_react tool', () => {
  it('reacts to a message', async () => {
    // Get a message to react to
    const readResult = await client.callTool({
      name: 'flock_read',
      arguments: { room_id: roomId, limit: 1 },
    });
    const messages = JSON.parse((readResult.content as Array<{ type: string; text: string }>)[0].text).messages;
    const msgId = messages[0].id;

    const result = await client.callTool({
      name: 'flock_react',
      arguments: { message_id: msgId, type: 'useful' },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.reaction).toBeDefined();
    expect(parsed.reaction.type).toBe('useful');
  });
});

describe('flock_thread tool', () => {
  it('returns thread for a message', async () => {
    // Send a reply first
    const readResult = await client.callTool({
      name: 'flock_read',
      arguments: { room_id: roomId, limit: 1 },
    });
    const messages = JSON.parse((readResult.content as Array<{ type: string; text: string }>)[0].text).messages;
    const parentId = messages[messages.length - 1].id;

    await client.callTool({
      name: 'flock_post',
      arguments: { room_id: roomId, content: 'This is a reply', reply_to: parentId },
    });

    const result = await client.callTool({
      name: 'flock_thread',
      arguments: { message_id: parentId },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    // flock_thread returns the messages array directly
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(2);
  });
});

describe('flock_wait', () => {
  it('returns existing new messages immediately (DB check)', async () => {
    // Send a message first (creates new sequence above baseline)
    await client.callTool({
      name: 'flock_agent_create',
      arguments: { name: 'WaitBot' },
    });
    resetAgentCache();
    resolveAgentId(db, 'WaitBot');
    await client.callTool({ name: 'flock_room_join', arguments: { room_id: roomId } });
    await client.callTool({ name: 'flock_post', arguments: { room_id: roomId, content: 'Pre-existing message for wait' } });

    // Switch back to original agent
    resetAgentCache();
    resolveAgentId(db, 'Week2Bot');

    // flock_wait should find it via DB check (no blocking needed)
    const waitResult = await client.callTool({
      name: 'flock_wait',
      arguments: { timeout_seconds: 3 },
    });

    const text = (waitResult.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.messages.length).toBeGreaterThanOrEqual(1);
  });

  it('blocks and returns when new message arrives via event', async () => {
    // Start flock_wait in background (will block since no new messages yet)
    const waitPromise = client.callTool({
      name: 'flock_wait',
      arguments: { timeout_seconds: 10 },
    });

    // Wait a moment, then emit a message directly via the event bus.
    // We use emitNewMessage instead of flock_post because InMemoryTransport
    // is synchronous — flock_post would queue behind flock_wait and never execute.
    await new Promise((r) => setTimeout(r, 500));
    emitNewMessage(roomId, {
      id: 'test-msg-id',
      from: 'other-agent-id',
      content: 'Trigger message for wait',
      sequence: 999,
      mentions: [],
      reply_to: null,
      created_at: new Date().toISOString(),
    });

    // flock_wait should resolve with the new message
    const waitResult = await waitPromise;
    const text = (waitResult.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.messages.length).toBeGreaterThanOrEqual(1);
    expect(parsed.messages.some((m: { content: string }) => m.content === 'Trigger message for wait')).toBe(true);
  });
});
