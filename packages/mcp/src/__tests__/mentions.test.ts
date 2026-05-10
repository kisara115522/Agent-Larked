import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDatabase } from '@flock/server/db';
import { registerAgent } from '@flock/server/services/identity';
import { createRoom, joinRoom } from '@flock/server/services/room';
import { sendMessage } from '@flock/server/services/messaging';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerMentionTools } from '../tools/mentions.js';
import { installUnreadMentionInjection, listMentionQueue, pollDirectMentionsOnce, startMentionListener } from '../mentions.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
let tempDir: string;
let oldFlockHome: string | undefined;
let recipient: { id: string; name: string; token: string };
let sender: { id: string; name: string; token: string };
let roomId: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'flock-mentions-'));
  oldFlockHome = process.env.FLOCK_HOME;
  process.env.FLOCK_HOME = tempDir;

  db = createDatabase(':memory:');
  recipient = registerAgent(db, { name: 'MentionRecipient' });
  sender = registerAgent(db, { name: 'MentionSender' });
  const room = createRoom(db, sender.id, { name: 'mention-room' });
  roomId = room.id;
  joinRoom(db, roomId, recipient.id);
});

afterEach(() => {
  db.close();
  if (oldFlockHome !== undefined) {
    process.env.FLOCK_HOME = oldFlockHome;
  } else {
    delete process.env.FLOCK_HOME;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe('direct mention queue', () => {
  it('persists direct mentions from joined rooms without full message content', () => {
    const sent = sendMessage(db, sender.id, {
      room_id: roomId,
      content: 'please review this secret instruction',
      mentions: [recipient.id],
      idempotency_key: 'mention-1',
    });

    const queued = pollDirectMentionsOnce(db, recipient.id);

    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      message_id: sent.id,
      room_id: roomId,
      sender_id: sender.id,
      recipient_id: recipient.id,
      sender_name: sender.name,
      room_name: 'mention-room',
      priority: 'direct',
    });
    expect(queued[0].excerpt.length).toBeLessThanOrEqual(80);
    expect(queued[0].excerpt).not.toContain('secret instruction');

    const persisted = listMentionQueue(recipient.id);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].dedupe_key).toBe(`${sent.id}:${recipient.id}`);
  });

  it('deduplicates direct mentions across repeated polling', () => {
    sendMessage(db, sender.id, {
      room_id: roomId,
      content: 'ping',
      mentions: [recipient.id],
      idempotency_key: 'mention-2',
    });

    expect(pollDirectMentionsOnce(db, recipient.id)).toHaveLength(1);
    expect(pollDirectMentionsOnce(db, recipient.id)).toHaveLength(0);
    expect(listMentionQueue(recipient.id)).toHaveLength(1);
  });

  it('skips malformed queue lines instead of failing the whole queue read', () => {
    writeFileSync(join(tempDir, 'unread.jsonl'), '{bad json}\n', 'utf-8');

    expect(listMentionQueue(recipient.id)).toEqual([]);
  });
});

describe('flock mention tools', () => {
  it('lists and drains queued direct mentions', async () => {
    sendMessage(db, sender.id, {
      room_id: roomId,
      content: 'please look',
      mentions: [recipient.id],
      idempotency_key: 'mention-3',
    });
    pollDirectMentionsOnce(db, recipient.id);

    const server = new McpServer({ name: 'mention-test', version: '0.1.0' });
    registerMentionTools(server, db, () => recipient.id);
    const client = new Client({ name: 'mention-client', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const listResult = await client.callTool({ name: 'flock_mentions_list', arguments: {} });
    const listed = JSON.parse((listResult.content as Array<{ text: string }>)[0].text);
    expect(listed.count).toBe(1);
    expect(listed.mentions[0].room_name).toBe('mention-room');

    const drainResult = await client.callTool({ name: 'flock_mentions_drain', arguments: {} });
    const drained = JSON.parse((drainResult.content as Array<{ text: string }>)[0].text);
    expect(drained.count).toBe(1);
    expect(listMentionQueue(recipient.id)).toHaveLength(0);

    await client.close();
  });
});

describe('unread mention response injection', () => {
  it('adds _unread_mentions digest to JSON tool responses', async () => {
    sendMessage(db, sender.id, {
      room_id: roomId,
      content: 'please inspect',
      mentions: [recipient.id],
      idempotency_key: 'mention-4',
    });

    const server = new McpServer({ name: 'mention-injection-test', version: '0.1.0' });
    installUnreadMentionInjection(server, db, () => recipient.id);
    server.registerTool(
      'dummy_tool',
      {
        description: 'dummy',
        inputSchema: {},
      },
      async () => ({
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }],
      }),
    );

    const client = new Client({ name: 'mention-client', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: 'dummy_tool', arguments: {} });
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(parsed.ok).toBe(true);
    expect(parsed._unread_mentions.count).toBe(1);
    expect(parsed._unread_mentions.summary).toContain('Flock: 1 unread direct mention');
    expect(parsed._unread_mentions.mentions[0].room_name).toBe('mention-room');

    await client.close();
  });

  it('adds _unread_mentions digest to server.tool responses', async () => {
    sendMessage(db, sender.id, {
      room_id: roomId,
      content: 'please inspect identity path',
      mentions: [recipient.id],
      idempotency_key: 'mention-server-tool',
    });

    const server = new McpServer({ name: 'mention-injection-tool-test', version: '0.1.0' });
    installUnreadMentionInjection(server, db, () => recipient.id);
    server.tool(
      'dummy_tool_with_legacy_api',
      'dummy',
      {},
      async () => ({
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }],
      }),
    );

    const client = new Client({ name: 'mention-client', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: 'dummy_tool_with_legacy_api', arguments: {} });
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(parsed.ok).toBe(true);
    expect(parsed._unread_mentions.count).toBe(1);
    expect(parsed._unread_mentions.mentions[0].room_name).toBe('mention-room');

    await client.close();
  });

  it('returns the original tool response when mention injection fails', async () => {
    const failingDb = {
      prepare: () => {
        throw new Error('poll failed');
      },
    } as unknown as Database.Database;
    const server = new McpServer({ name: 'mention-injection-failure-test', version: '0.1.0' });
    installUnreadMentionInjection(server, failingDb, () => recipient.id);
    server.registerTool(
      'dummy_tool',
      {
        description: 'dummy',
        inputSchema: {},
      },
      async () => ({
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }],
      }),
    );

    const client = new Client({ name: 'mention-client', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: 'dummy_tool', arguments: {} });
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(parsed).toEqual({ ok: true });

    await client.close();
  });
});

describe('background mention listener', () => {
  it('writes local listener status and marks it stopped', () => {
    const listener = startMentionListener(db, () => recipient.id, 1000);
    const statusPath = join(tempDir, 'mentions-listener.json');

    expect(existsSync(statusPath)).toBe(true);
    expect(JSON.parse(readFileSync(statusPath, 'utf-8'))).toMatchObject({
      agent_id: recipient.id,
      status: 'running',
    });

    listener.stop();

    expect(JSON.parse(readFileSync(statusPath, 'utf-8'))).toMatchObject({
      agent_id: recipient.id,
      status: 'stopped',
    });
  });

  it('polls direct mentions on an interval and can be stopped', () => {
    vi.useFakeTimers();
    try {
      const listener = startMentionListener(db, () => recipient.id, 1000);

      sendMessage(db, sender.id, {
        room_id: roomId,
        content: 'queued later',
        mentions: [recipient.id],
        idempotency_key: 'mention-5',
      });

      expect(listMentionQueue(recipient.id)).toHaveLength(0);
      vi.advanceTimersByTime(1000);
      expect(listMentionQueue(recipient.id)).toHaveLength(1);

      listener.stop();
      sendMessage(db, sender.id, {
        room_id: roomId,
        content: 'not queued after stop',
        mentions: [recipient.id],
        idempotency_key: 'mention-6',
      });
      vi.advanceTimersByTime(1000);
      expect(listMentionQueue(recipient.id)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
