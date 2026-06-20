import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDatabase } from '@flock/server/db';
import { registerAgent } from '@flock/server/services/identity';
import { registerTodoTools } from '../tools/todo.js';
import { resetAgentCache } from '../db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Database from 'better-sqlite3';

let db: Database.Database;
let client: Client;
let tempDir: string;
let testAgentId: string;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'flock-todo-'));
  process.env.FLOCK_HOME = tempDir;

  db = createDatabase(':memory:');

  // Create test agent via proper registration
  const agent = registerAgent(db, { name: 'todo-test-agent' });
  testAgentId = agent.id;

  const server = new McpServer({ name: 'test-todo', version: '0.1.0' });
  registerTodoTools(server, db, () => testAgentId);

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
  rmSync(tempDir, { recursive: true, force: true });
  resetAgentCache();
});

describe('flock_todo tools', () => {
  it('flock_todo_add creates a todo and returns its id', async () => {
    const result = await client.callTool({ name: 'flock_todo_add', arguments: { content: 'Review PR #42', priority: 5 } });
    expect(result.content).toBeDefined();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.added).toBeDefined();
    expect(parsed.content).toBe('Review PR #42');
  });

  it('flock_todo_list returns open todos', async () => {
    const result = await client.callTool({ name: 'flock_todo_list', arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.open_todos.length).toBeGreaterThanOrEqual(1);
    expect(parsed.open_todos.some((t: { content: string }) => t.content === 'Review PR #42')).toBe(true);
  });

  it('flock_todo_complete marks a todo done', async () => {
    // Get the todo id
    const listResult = await client.callTool({ name: 'flock_todo_list', arguments: {} });
    const listText = (listResult.content as Array<{ type: string; text: string }>)[0].text;
    const todos = JSON.parse(listText).open_todos;
    const todoId = todos[0].id;

    const result = await client.callTool({ name: 'flock_todo_complete', arguments: { todo_id: todoId } });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text).updated).toBe(true);

    // Verify it's gone from open list
    const listAfter = await client.callTool({ name: 'flock_todo_list', arguments: {} });
    const afterText = (listAfter.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(afterText).open_todos).toHaveLength(0);
  });
});
