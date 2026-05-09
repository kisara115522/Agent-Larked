import { describe, it, expect, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDatabase } from '@flock/server/db';
import { registerAgent } from '@flock/server/services/identity';
import { sendDirectMessage } from '@flock/server/services/direct-chat';
import { registerDirectChatTools } from '../tools/direct-chat.js';
import { registerWaitTool } from '../tools/subscribe.js';
import { resetAgentCache, resolveAgentId } from '../db.js';
import type Database from 'better-sqlite3';

let db: Database.Database | null = null;

afterEach(() => {
  resetAgentCache();
  db?.close();
  db = null;
});

async function makeClient(server: McpServer): Promise<Client> {
  const client = new Client({ name: 'direct-chat-client', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('MCP Direct Chat tools', () => {
  it('sends, lists, and reads 1:1 direct chats', async () => {
    db = createDatabase(':memory:');
    const alice = registerAgent(db, { name: 'McpDirectAlice' });
    const bob = registerAgent(db, { name: 'McpDirectBob' });
    resetAgentCache();
    resolveAgentId(db, alice.name);

    const server = new McpServer({ name: 'direct-chat-test', version: '0.1.0' });
    registerDirectChatTools(server, db);
    const client = await makeClient(server);

    const sent = await client.callTool({
      name: 'flock_dm_send',
      arguments: { agent_id: bob.id, content: 'hello in dm', idempotency_key: 'mcp-dm-1' },
    });
    const sentBody = JSON.parse((sent.content as Array<{ text: string }>)[0].text);
    expect(sentBody.sequence).toBe(1);

    const listed = await client.callTool({ name: 'flock_dm_list', arguments: {} });
    const listBody = JSON.parse((listed.content as Array<{ text: string }>)[0].text);
    expect(listBody.chats).toHaveLength(1);
    expect(listBody.chats[0].peer_id).toBe(bob.id);

    const read = await client.callTool({
      name: 'flock_dm_read',
      arguments: { agent_id: bob.id },
    });
    const readBody = JSON.parse((read.content as Array<{ text: string }>)[0].text);
    expect(readBody.messages[0].content).toBe('hello in dm');

    await client.close();
  });
});

describe('flock_wait direct messages', () => {
  it('returns unread direct messages without room membership', async () => {
    db = createDatabase(':memory:');
    const recipient = registerAgent(db, { name: 'McpWaitDirectRecipient' });
    const sender = registerAgent(db, { name: 'McpWaitDirectSender' });
    resetAgentCache();
    resolveAgentId(db, recipient.name);

    sendDirectMessage(db, sender.id, recipient.id, {
      content: 'private wake up',
      idempotency_key: 'wait-dm-1',
    });

    const server = new McpServer({ name: 'direct-wait-test', version: '0.1.0' });
    registerWaitTool(server, db);
    const client = await makeClient(server);

    const result = await client.callTool({
      name: 'flock_wait',
      arguments: { timeout_seconds: 1 },
    });
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);

    expect(parsed.direct_messages).toHaveLength(1);
    expect(parsed.direct_messages[0].content).toBe('private wake up');
    expect(parsed.count).toBe(1);

    await client.close();
  });
});
