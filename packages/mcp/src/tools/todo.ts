import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { addTodo, listOpenTodos, setTodoStatus } from '@flock/server/services/inbox';
import { getAgentId } from '../db.js';

export function registerTodoTools(
  server: McpServer,
  db: Database.Database,
  agentIdProvider: () => string | null = getAgentId,
): void {
  server.registerTool(
    'flock_todo_add',
    {
      description:
        'Add an item to YOUR OWN private todo queue. Use this when a new message or idea arrives ' +
        'but your current work is more important — capture it here so you address it later instead of ' +
        'dropping it or interrupting yourself. The queue is surfaced back to you at every tool boundary.',
      inputSchema: z.object({
        content: z.string().describe('What needs to be done, in your own words.'),
        priority: z.number().optional().describe('Higher = more urgent. Default 0.'),
        source_message_id: z.string().optional().describe('If this todo came from an inbox message, its id.'),
      }),
    },
    async (args) => {
      const agentId = agentIdProvider();
      if (!agentId) return { content: [{ type: 'text' as const, text: 'Error: agent not registered.' }], isError: true };
      const todo = addTodo(db, { agentId, content: args.content, priority: args.priority, sourceMessageId: args.source_message_id ?? null });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ added: todo.id, content: todo.content }) }] };
    },
  );

  server.registerTool(
    'flock_todo_list',
    {
      description: 'List YOUR open todos, highest priority first. Call this when you reach a stopping point to decide what to do next.',
      inputSchema: z.object({}),
    },
    async () => {
      const agentId = agentIdProvider();
      if (!agentId) return { content: [{ type: 'text' as const, text: 'Error: agent not registered.' }], isError: true };
      const todos = listOpenTodos(db, agentId);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ open_todos: todos.map((t) => ({ id: t.id, content: t.content, priority: t.priority })) }) }] };
    },
  );

  server.registerTool(
    'flock_todo_complete',
    {
      description: 'Mark one of YOUR todos done (status="done") or drop it (status="dropped"). Always complete a todo after you finish the work it describes.',
      inputSchema: z.object({
        todo_id: z.string().describe('The todo id to update.'),
        status: z.enum(['done', 'dropped']).optional().describe('done (default) or dropped.'),
      }),
    },
    async (args) => {
      const agentId = agentIdProvider();
      if (!agentId) return { content: [{ type: 'text' as const, text: 'Error: agent not registered.' }], isError: true };
      const ok = setTodoStatus(db, agentId, args.todo_id, args.status ?? 'done');
      return { content: [{ type: 'text' as const, text: JSON.stringify({ updated: ok, todo_id: args.todo_id }) }] };
    },
  );
}
