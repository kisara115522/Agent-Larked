import { describe, it, expect, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDatabase } from '@flock/server/db';
import { registerAgent } from '@flock/server/services/identity';
import { createRoom, joinRoom } from '@flock/server/services/room';
import { resetAgentCache, resolveAgentId, setAgentOnline } from '../db.js';
import { emitNewMessage, registerWaitTool } from '../tools/subscribe.js';
import type Database from 'better-sqlite3';

let db: Database.Database | null = null;

afterEach(() => {
  vi.useRealTimers();
  resetAgentCache();
  db?.close();
  db = null;
});

describe('MCP agent lifecycle', () => {
  it('keeps the agent online while flock_wait is pending and starts the idle timer after it returns', async () => {
    vi.useFakeTimers();
    db = createDatabase(':memory:');
    const agent = registerAgent(db, { name: 'LifecycleWaiter' });
    const sender = registerAgent(db, { name: 'LifecycleSender' });
    const room = createRoom(db, sender.id, { name: 'lifecycle-room' });
    joinRoom(db, room.id, agent.id);

    resetAgentCache();
    resolveAgentId(db, agent.name);
    setAgentOnline(db);

    const server = new McpServer({ name: 'lifecycle-test', version: '0.1.0' });
    registerWaitTool(server, db);
    const client = new Client({ name: 'lifecycle-client', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const waitPromise = client.callTool({
      name: 'flock_wait',
      arguments: { timeout_seconds: 3600 },
    }, undefined, { timeout: 30 * 60 * 1000 });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    const duringWait = db.prepare('SELECT status FROM profiles WHERE id = ?').get(agent.id) as { status: string };
    expect(duringWait.status).toBe('online');

    emitNewMessage(room.id, {
      id: 'lifecycle-message',
      from: sender.id,
      content: 'wake up',
      sequence: 1,
      mentions: [],
      reply_to: null,
      created_at: new Date().toISOString(),
    });
    await waitPromise;

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    const afterIdle = db.prepare('SELECT status FROM profiles WHERE id = ?').get(agent.id) as { status: string };
    expect(afterIdle.status).toBe('offline');

    await client.close();
  });
});
