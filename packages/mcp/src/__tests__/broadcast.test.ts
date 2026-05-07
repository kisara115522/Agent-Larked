import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createDatabase } from '@flock/server/db';
import type Database from 'better-sqlite3';

import { registerIdentityTools } from '../tools/identity.js';
import { registerRoomTools } from '../tools/room.js';
import { registerMessagingTools } from '../tools/messaging.js';
import { registerBroadcastTools } from '../tools/broadcast.js';
import { resetAgentCache, setAgentId } from '../db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Broadcast MCP Tools', () => {
  let db: Database.Database;
  let client: Client;
  let originalFlockHome: string | undefined;
  let tempDir: string;

  beforeAll(async () => {
    originalFlockHome = process.env.FLOCK_HOME;
    tempDir = mkdtempSync(join(tmpdir(), 'flock-broadcast-test-'));
    process.env.FLOCK_HOME = tempDir;

    db = createDatabase(':memory:');
    const server = new McpServer({ name: 'test-flock', version: '0.1.0' });

    registerIdentityTools(server, db);
    registerRoomTools(server, db);
    registerMessagingTools(server, db);
    registerBroadcastTools(server, db);

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
    process.env.FLOCK_HOME = originalFlockHome;
    rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetAgentCache();
  });

  async function registerAgent(name: string): Promise<{ id: string; token: string }> {
    const result = await client.callTool({
      name: 'flock_register',
      arguments: { name },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    return JSON.parse(text);
  }

  describe('flock_broadcast', () => {
    it('should send a broadcast message', async () => {
      const { id: agentId, token } = await registerAgent('broadcaster-1');

      // Set the token for subsequent calls
      process.env.AGENT_TOKEN = token;

      const result = await client.callTool({
        name: 'flock_broadcast',
        arguments: {
          content: 'Hello from broadcaster!',
          idempotency_key: 'test-broadcast-1',
        },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const response = JSON.parse(text);
      expect(response).toHaveProperty('id');
      expect(response).toHaveProperty('created_at');
    });

    it('should send broadcast with mentions', async () => {
      const broadcaster = await registerAgent('broadcaster-2');
      const mentioned = await registerAgent('mentioned-1');

      const result = await client.callTool({
        name: 'flock_broadcast',
        arguments: {
          content: 'Check this out!',
          mentions: [mentioned.id],
          idempotency_key: 'test-broadcast-2',
        },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const response = JSON.parse(text);
      expect(response).toHaveProperty('id');
    });

    it('should be idempotent', async () => {
      await registerAgent('broadcaster-3');

      const result1 = await client.callTool({
        name: 'flock_broadcast',
        arguments: {
          content: 'Idempotent test',
          idempotency_key: 'idem-broadcast-1',
        },
      });

      const result2 = await client.callTool({
        name: 'flock_broadcast',
        arguments: {
          content: 'Idempotent test',
          idempotency_key: 'idem-broadcast-1',
        },
      });

      const text1 = (result1.content as Array<{ type: string; text: string }>)[0].text;
      const text2 = (result2.content as Array<{ type: string; text: string }>)[0].text;
      const id1 = JSON.parse(text1).id;
      const id2 = JSON.parse(text2).id;
      expect(id1).toBe(id2);
    });
  });

  describe('flock_feed', () => {
    it('should return feed from followed agents', async () => {
      // Register broadcaster and follower
      const broadcaster = await registerAgent('feed-broadcaster');
      const follower = await registerAgent('feed-follower');

      // Follower follows broadcaster (direct DB insert since we don't have follow tool yet)
      db.prepare(
        'INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)',
      ).run(follower.id, broadcaster.id, new Date().toISOString());

      // Set agent ID to broadcaster for sending broadcast
      setAgentId(broadcaster.id, 'feed-broadcaster');

      // Broadcaster sends a broadcast
      await client.callTool({
        name: 'flock_broadcast',
        arguments: {
          content: 'Feed test message',
          idempotency_key: 'feed-test-1',
        },
      });

      // Set agent ID to follower for getting feed
      setAgentId(follower.id, 'feed-follower');

      // Follower gets feed
      const result = await client.callTool({
        name: 'flock_feed',
        arguments: {},
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const response = JSON.parse(text);
      expect(response.messages).toBeInstanceOf(Array);
      expect(response.messages.length).toBeGreaterThan(0);
      expect(response.messages[0].content).toBe('Feed test message');
    });

    it('should return empty feed when not following anyone', async () => {
      const agent = await registerAgent('lonely-agent');
      setAgentId(agent.id, 'lonely-agent');

      const result = await client.callTool({
        name: 'flock_feed',
        arguments: {},
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const response = JSON.parse(text);
      expect(response.messages).toEqual([]);
    });

    it('should support limit parameter', async () => {
      const broadcaster = await registerAgent('feed-limiter');
      const follower = await registerAgent('feed-limit-follower');

      // Follow
      db.prepare(
        'INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)',
      ).run(follower.id, broadcaster.id, new Date().toISOString());

      // Set agent ID to broadcaster for sending broadcasts
      setAgentId(broadcaster.id, 'feed-limiter');

      // Send multiple broadcasts
      for (let i = 0; i < 5; i++) {
        await client.callTool({
          name: 'flock_broadcast',
          arguments: {
            content: `Limit test ${i}`,
            idempotency_key: `limit-${i}`,
          },
        });
      }

      // Set agent ID to follower for getting feed
      setAgentId(follower.id, 'feed-limit-follower');

      // Get feed with limit
      const result = await client.callTool({
        name: 'flock_feed',
        arguments: { limit: 2 },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const response = JSON.parse(text);
      expect(response.messages.length).toBeLessThanOrEqual(2);
    });
  });
});
