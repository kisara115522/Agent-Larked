import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { createTask, getTask, listTasks, updateTask } from '@flock/server/services/task';
import { getAgentId } from '../db.js';

export function registerTaskTools(
  server: McpServer,
  db: Database.Database,
  agentIdProvider: () => string | null = getAgentId,
): void {
  server.tool(
    'flock_task_create',
    'Create a new task in a room. Tasks are tracked with a state machine (todo → in_progress → review → done).',
    {
      room_id: z.string().describe('Room ID where the task belongs'),
      title: z.string().describe('Task title'),
      description: z.string().optional().describe('Task description'),
      assigned_to: z.string().optional().describe('Agent ID to assign the task to'),
      priority: z.number().optional().describe('Priority (0=normal, 1=high, 2=urgent)'),
      required_capabilities: z.array(z.string()).optional().describe('Capabilities required for this task'),
    },
    async (args) => {
      try {
        const agentId = agentIdProvider();
        if (!agentId) {
          return { content: [{ type: 'text' as const, text: 'Error: Agent not registered.' }], isError: true };
        }
        const result = createTask(db, agentId, {
          room_id: args.room_id,
          title: args.title,
          description: args.description,
          assigned_to: args.assigned_to,
          priority: args.priority,
          required_capabilities: args.required_capabilities,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );

  server.tool(
    'flock_task_list',
    'List tasks in a room, optionally filtered by status.',
    {
      room_id: z.string().optional().describe('Filter by room ID'),
      status: z.string().optional().describe('Filter by status (todo/in_progress/review/done/rejected/error)'),
      limit: z.number().optional().describe('Max results (default 50, max 100)'),
      cursor: z.string().optional().describe('Pagination cursor'),
    },
    async (args) => {
      try {
        const result = listTasks(db, {
          room_id: args.room_id,
          status: args.status,
          limit: args.limit,
          cursor: args.cursor,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );

  server.tool(
    'flock_task_update',
    'Update a task\'s status or assignment. Status transitions are validated by the state machine.',
    {
      task_id: z.string().describe('Task ID to update'),
      status: z.enum(['todo', 'in_progress', 'review', 'done', 'rejected', 'error']).optional().describe('New status'),
      assigned_to: z.string().optional().describe('Reassign to this agent ID'),
      description: z.string().optional().describe('Update description'),
    },
    async (args) => {
      try {
        const agentId = agentIdProvider();
        if (!agentId) {
          return { content: [{ type: 'text' as const, text: 'Error: Agent not registered.' }], isError: true };
        }
        const result = updateTask(db, args.task_id, agentId, {
          status: args.status,
          assigned_to: args.assigned_to,
          description: args.description,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );

  server.tool(
    'flock_project_status',
    'Get all tasks in a room as a project overview. Any agent can call this to see overall progress.',
    {
      room_id: z.string().describe('Room ID to get project status for'),
    },
    async (args) => {
      try {
        const result = listTasks(db, { room_id: args.room_id, limit: 100 });
        const byStatus = {
          todo: result.tasks.filter(t => t.status === 'todo'),
          in_progress: result.tasks.filter(t => t.status === 'in_progress'),
          review: result.tasks.filter(t => t.status === 'review'),
          done: result.tasks.filter(t => t.status === 'done'),
          rejected: result.tasks.filter(t => t.status === 'rejected'),
          error: result.tasks.filter(t => t.status === 'error'),
        };
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              room_id: args.room_id,
              total: result.tasks.length,
              by_status: {
                todo: byStatus.todo.length,
                in_progress: byStatus.in_progress.length,
                review: byStatus.review.length,
                done: byStatus.done.length,
                rejected: byStatus.rejected.length,
                error: byStatus.error.length,
              },
              tasks: result.tasks,
            }),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );
}
