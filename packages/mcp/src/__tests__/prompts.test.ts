import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerPrompts } from '../prompts.js';

let client: Client;

beforeAll(async () => {
  const server = new McpServer({ name: 'test-flock-prompts', version: '0.1.0' });
  registerPrompts(server);

  client = new Client({ name: 'test-client', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('MCP Prompts', () => {
  it('lists all registered prompts', async () => {
    const result = await client.listPrompts();
    const names = result.prompts.map((p) => p.name);
    expect(names).toContain('flock-collaborate');
    expect(names).toContain('flock-review');
    expect(names).toContain('flock-standup');
  });

  it('flock-collaborate returns workflow prompt', async () => {
    const result = await client.getPrompt({
      name: 'flock-collaborate',
      arguments: { task: 'Review authentication module' },
    });

    expect(result.messages).toHaveLength(1);
    const msg = result.messages[0];
    expect(msg.role).toBe('user');
    const text = (msg.content as { type: string; text: string }).text;
    expect(text).toContain('Review authentication module');
    expect(text).toContain('flock_wait');
    expect(text).toContain('flock_discover');
  });

  it('flock-review returns code review prompt', async () => {
    const result = await client.getPrompt({
      name: 'flock-review',
      arguments: { code_or_pr: 'function login() { ... }' },
    });

    expect(result.messages).toHaveLength(1);
    const text = (result.messages[0].content as { type: string; text: string }).text;
    expect(text).toContain('function login()');
    expect(text).toContain('flock_post');
    expect(text).toContain('reply_to');
  });

  it('flock-standup returns standup prompt', async () => {
    const result = await client.getPrompt({
      name: 'flock-standup',
      arguments: { project: 'Flock' },
    });

    expect(result.messages).toHaveLength(1);
    const text = (result.messages[0].content as { type: string; text: string }).text;
    expect(text).toContain('Flock');
    expect(text).toContain('standup');
    expect(text).toContain('flock_wait');
  });
});
