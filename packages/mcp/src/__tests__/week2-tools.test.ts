import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDatabase } from '@flock/server/db';
import { clearPendingRoomWakesForTests } from '@flock/server/services/callback';
import { registerIdentityTools } from '../tools/identity.js';
import { registerRoomTools } from '../tools/room.js';
import { registerMessagingTools } from '../tools/messaging.js';
import { registerReactionTools } from '../tools/reactions.js';
import { registerWaitTool, emitNewMessage, resetSequenceBaselines } from '../tools/subscribe.js';
import { resetAgentCache, resolveAgentId } from '../db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
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
  resetSequenceBaselines();
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

afterEach(() => {
  clearPendingRoomWakesForTests();
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

  it('resolves textual @mentions and wakes the mentioned agent', async () => {
    const callbackCalls: Array<{ url: string | undefined; body: Record<string, unknown> }> = [];
    const callbackServer = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += String(chunk); });
      req.on('end', () => {
        callbackCalls.push({ url: req.url, body: JSON.parse(body) as Record<string, unknown> });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    await new Promise<void>((resolve) => callbackServer.listen(0, '127.0.0.1', resolve));
    try {
      const address = callbackServer.address();
      if (!address || typeof address === 'string') {
        throw new Error('callback server did not bind to a TCP port');
      }

      const regResult = await client.callTool({
        name: 'flock_agent_create',
        arguments: { name: 'TextMentionBot' },
      });
      const mentionedId = JSON.parse((regResult.content as Array<{ type: string; text: string }>)[0].text).id as string;

      resetAgentCache();
      resolveAgentId(db, 'TextMentionBot');
      await client.callTool({ name: 'flock_room_join', arguments: { room_id: roomId } });

      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO agent_runtimes (id, host, port, callback_url, callback_secret_hash, callback_secret, capabilities, max_agents, status, last_heartbeat_at, created_at)
        VALUES ('mcp-text-mention-runtime', '127.0.0.1', ?, ?, 'hash', 'secret', '[]', 10, 'online', ?, ?)
      `).run(address.port, `http://127.0.0.1:${address.port}`, now, now);
      db.prepare("UPDATE profiles SET status = 'dormant' WHERE id = ?").run(mentionedId);
      db.prepare(`
        INSERT INTO agent_spawns (id, agent_id, runtime_id, status, spawned_at, last_active_at, prompt)
        VALUES ('mcp-text-mention-spawn', ?, 'mcp-text-mention-runtime', 'stopped', ?, ?, 'previous')
      `).run(mentionedId, now, now);

      resetAgentCache();
      resolveAgentId(db, 'Week2Bot');
      const result = await client.callTool({
        name: 'flock_post',
        arguments: { room_id: roomId, content: '@TextMentionBot please wake from another agent' },
      });

      expect(result.isError).not.toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(callbackCalls).toHaveLength(1);
      expect(callbackCalls[0].body).toMatchObject({
        type: 'wake',
        trigger_type: 'mention',
        agent_name: 'TextMentionBot',
        room_id: roomId,
      });
    } finally {
      await new Promise<void>((resolve) => callbackServer.close(() => resolve()));
    }
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

describe('flock_room_sync tool', () => {
  it('returns unread messages and advances the room cursor', async () => {
    resetAgentCache();
    resolveAgentId(db, 'Week2Bot');

    const senderResult = await client.callTool({
      name: 'flock_agent_create',
      arguments: { name: 'SyncSender' },
    });
    const senderId = JSON.parse((senderResult.content as Array<{ type: string; text: string }>)[0].text).id;

    resetAgentCache();
    resolveAgentId(db, 'SyncSender');
    await client.callTool({ name: 'flock_room_join', arguments: { room_id: roomId } });
    await client.callTool({ name: 'flock_room_sync', arguments: { room_id: roomId } });
    const postResult = await client.callTool({
      name: 'flock_post',
      arguments: { room_id: roomId, content: 'sync unread message' },
    });
    expect(JSON.parse((postResult.content as Array<{ type: string; text: string }>)[0].text).id).toBeDefined();

    resetAgentCache();
    resolveAgentId(db, 'Week2Bot');
    const result = await client.callTool({
      name: 'flock_room_sync',
      arguments: { room_id: roomId },
    });

    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.room_id).toBe(roomId);
    expect(parsed.rules.version).toBe(0);
    expect(parsed.unread_messages.some((m: { from: string; content: string }) => m.from === senderId && m.content === 'sync unread message')).toBe(true);
    expect(parsed.state.last_seen_sequence).toBe(parsed.latest_sequence);

    const second = await client.callTool({
      name: 'flock_room_sync',
      arguments: { room_id: roomId },
    });
    const secondParsed = JSON.parse((second.content as Array<{ type: string; text: string }>)[0].text);
    expect(secondParsed.unread_messages).toEqual([]);
  });

  it('returns room rules only when the rules version changes', async () => {
    resetAgentCache();
    resolveAgentId(db, 'Week2Bot');
    const roomResult = await client.callTool({
      name: 'flock_room_create',
      arguments: {
        name: 'rules-sync-room',
        rules: 'Rule v1: answer only when mentioned.',
      },
    });
    const rulesRoomId = JSON.parse((roomResult.content as Array<{ type: string; text: string }>)[0].text).id;

    const firstSync = await client.callTool({
      name: 'flock_room_sync',
      arguments: { room_id: rulesRoomId },
    });
    const firstParsed = JSON.parse((firstSync.content as Array<{ type: string; text: string }>)[0].text);
    expect(firstParsed.rules).toMatchObject({
      version: 1,
      unchanged: false,
      content: 'Rule v1: answer only when mentioned.',
    });

    const secondSync = await client.callTool({
      name: 'flock_room_sync',
      arguments: { room_id: rulesRoomId },
    });
    const secondParsed = JSON.parse((secondSync.content as Array<{ type: string; text: string }>)[0].text);
    expect(secondParsed.rules).toMatchObject({
      version: 1,
      unchanged: true,
      content: null,
    });

    const updateResult = await client.callTool({
      name: 'flock_room_rules_set',
      arguments: {
        room_id: rulesRoomId,
        rules: 'Rule v2: wait for the moderator before acting.',
      },
    });
    const updateParsed = JSON.parse((updateResult.content as Array<{ type: string; text: string }>)[0].text);
    expect(updateParsed.rules_version).toBe(2);

    const thirdSync = await client.callTool({
      name: 'flock_room_sync',
      arguments: { room_id: rulesRoomId },
    });
    const thirdParsed = JSON.parse((thirdSync.content as Array<{ type: string; text: string }>)[0].text);
    expect(thirdParsed.rules).toMatchObject({
      version: 2,
      unchanged: false,
      content: 'Rule v2: wait for the moderator before acting.',
    });
  });

  it('blocks flock_post when room rules changed since the last sync', async () => {
    resetAgentCache();
    resolveAgentId(db, 'Week2Bot');
    const roomResult = await client.callTool({
      name: 'flock_room_create',
      arguments: {
        name: 'rules-guard-room',
        rules: 'Initial room rules',
      },
    });
    const guardedRoomId = JSON.parse((roomResult.content as Array<{ type: string; text: string }>)[0].text).id;
    await client.callTool({ name: 'flock_room_sync', arguments: { room_id: guardedRoomId } });

    await client.callTool({
      name: 'flock_room_rules_set',
      arguments: {
        room_id: guardedRoomId,
        rules: 'Updated room rules',
      },
    });

    const blocked = await client.callTool({
      name: 'flock_post',
      arguments: { room_id: guardedRoomId, content: 'reply without seeing new rules' },
    });

    expect(blocked.isError).toBe(true);
    const text = (blocked.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('room rules version');
    expect(text).toContain('flock_room_sync');
  });

  it('blocks flock_post when another agent has posted unread messages since the last sync', async () => {
    resetAgentCache();
    resolveAgentId(db, 'Week2Bot');
    await client.callTool({ name: 'flock_room_sync', arguments: { room_id: roomId } });

    const blockerResult = await client.callTool({
      name: 'flock_agent_create',
      arguments: { name: 'PostGuardSender' },
    });
    expect(JSON.parse((blockerResult.content as Array<{ type: string; text: string }>)[0].text).id).toBeDefined();

    resetAgentCache();
    resolveAgentId(db, 'PostGuardSender');
    await client.callTool({ name: 'flock_room_join', arguments: { room_id: roomId } });
    await client.callTool({ name: 'flock_room_sync', arguments: { room_id: roomId } });
    await client.callTool({
      name: 'flock_post',
      arguments: { room_id: roomId, content: 'new message before guarded post' },
    });

    resetAgentCache();
    resolveAgentId(db, 'Week2Bot');
    const blocked = await client.callTool({
      name: 'flock_post',
      arguments: { room_id: roomId, content: 'stale reply should be blocked' },
    });

    expect(blocked.isError).toBe(true);
    const text = (blocked.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('flock_room_sync');

    await client.callTool({ name: 'flock_room_sync', arguments: { room_id: roomId } });
    const allowed = await client.callTool({
      name: 'flock_post',
      arguments: { room_id: roomId, content: 'fresh reply after sync' },
    });
    expect(allowed.isError).not.toBe(true);
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
    // Reset sequence baselines so the test starts clean
    resetSequenceBaselines();

    // Register a second agent and have it post a message
    const waitBotResult = await client.callTool({
      name: 'flock_agent_create',
      arguments: { name: 'WaitBot' },
    });
    const waitBotId = JSON.parse((waitBotResult.content as Array<{ type: string; text: string }>)[0].text).id;

    // Switch to WaitBot
    resetAgentCache();
    const resolved = resolveAgentId(db, 'WaitBot');
    expect(resolved.id).toBe(waitBotId);

    // WaitBot joins room
    await client.callTool({ name: 'flock_room_join', arguments: { room_id: roomId } });
    await client.callTool({ name: 'flock_room_sync', arguments: { room_id: roomId } });

    // Verify WaitBot is in room_members
    const members = db.prepare('SELECT agent_id FROM room_members WHERE room_id = ?').all(roomId) as { agent_id: string }[];
    expect(members.some(m => m.agent_id === waitBotId)).toBe(true);

    // WaitBot posts a message
    const postResult = await client.callTool({
      name: 'flock_post',
      arguments: { room_id: roomId, content: 'Pre-existing message for wait' },
    });
    const postParsed = JSON.parse((postResult.content as Array<{ type: string; text: string }>)[0].text);
    expect(postParsed.sequence).toBeGreaterThan(0);

    // Verify message exists in DB
    const msgs = db.prepare('SELECT from_agent, content FROM messages WHERE room_id = ?').all(roomId) as { from_agent: string; content: string }[];
    expect(msgs.some(m => m.from_agent === waitBotId && m.content === 'Pre-existing message for wait')).toBe(true);

    // Switch back to Week2Bot
    resetAgentCache();
    const week2Resolved = resolveAgentId(db, 'Week2Bot');
    expect(week2Resolved.id).toBe(agentId);

    // Verify Week2Bot is in room_members
    const week2Members = db.prepare('SELECT agent_id FROM room_members WHERE room_id = ? AND agent_id = ?').all(roomId, agentId) as { agent_id: string }[];
    expect(week2Members.length).toBe(1);

    // flock_wait should find WaitBot's message via DB check (no blocking needed)
    const waitResult = await client.callTool({
      name: 'flock_wait',
      arguments: { timeout_seconds: 3 },
    });

    const text = (waitResult.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.messages.length).toBeGreaterThanOrEqual(1);
    expect(parsed.messages.some((m: { content: string }) => m.content === 'Pre-existing message for wait')).toBe(true);
  });

  it('blocks and returns when new message arrives via event', async () => {
    resetAgentCache();
    resolveAgentId(db, 'Week2Bot');
    resetSequenceBaselines();

    await client.callTool({
      name: 'flock_wait',
      arguments: { timeout_seconds: 1 },
    });

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
