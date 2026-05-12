import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createTask, listTasks, getTask, appendTaskEvent, addTaskArtifact } from '@flock/server/services/task';
import { getAgentId } from '../db.js';

export function registerTaskTools(server: McpServer, db: Database.Database): void {
  // Tool 1: flock_task_create
  server.registerTool(
    'flock_task_create',
    {
      description: 'Create a task in a room. Tasks represent assignable work items with status tracking and artifacts.',
      inputSchema: z.object({
        room_id: z.string().describe('ID of the room to create the task in'),
        title: z.string().describe('Task title (1-200 chars)'),
        description: z.string().optional().describe('Task description (max 16KiB)'),
        assignees: z.array(z.string()).optional().describe('Agent IDs to assign (must be room members)'),
        origin_message_id: z.string().optional().describe('Source message ID (must be in same room)'),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().describe('Task priority (default: normal)'),
        idempotency_key: z.string().optional().describe('Optional key for idempotent retries. Auto-generated if omitted.'),
      }),
    },
    async (args) => {
      try {
        const agentId = getAgentId();
        if (!agentId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Agent not registered.' }],
            isError: true,
          };
        }

        const result = createTask(db, agentId, {
          room_id: args.room_id,
          title: args.title,
          description: args.description,
          assignees: args.assignees,
          origin_message_id: args.origin_message_id,
          priority: args.priority,
          idempotency_key: args.idempotency_key ?? randomUUID(),
        });

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // Tool 2: flock_task_list
  server.registerTool(
    'flock_task_list',
    {
      description: 'List tasks visible to the current agent. Filter by room, status, assignee, or creator.',
      inputSchema: z.object({
        room_id: z.string().optional().describe('Filter by room ID'),
        status: z.enum(['open', 'accepted', 'in_progress', 'blocked', 'completed', 'cancelled']).optional().describe('Filter by status'),
        assignee_id: z.string().optional().describe('Filter by assignee agent ID'),
        created_by: z.string().optional().describe('Filter by creator agent ID'),
        limit: z.number().optional().describe('Max results (default 20, max 100)'),
        cursor: z.string().optional().describe('Pagination cursor'),
      }),
    },
    async (args) => {
      try {
        const agentId = getAgentId();
        if (!agentId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Agent not registered.' }],
            isError: true,
          };
        }

        const result = listTasks(db, agentId, {
          room_id: args.room_id,
          status: args.status,
          assignee_id: args.assignee_id,
          created_by: args.created_by,
          limit: args.limit,
          cursor: args.cursor,
        });

        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // Tool 3: flock_task_get
  server.registerTool(
    'flock_task_get',
    {
      description: 'Get full task details including assignees, events, and artifacts.',
      inputSchema: z.object({
        task_id: z.string().describe('Task ID'),
      }),
    },
    async (args) => {
      try {
        const agentId = getAgentId();
        if (!agentId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Agent not registered.' }],
            isError: true,
          };
        }

        const result = getTask(db, agentId, args.task_id);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // Tool 4: flock_task_update
  server.registerTool(
    'flock_task_update',
    {
      description: 'Append an event to a task. Optionally change status (must follow state machine rules). Use body for comments.',
      inputSchema: z.object({
        task_id: z.string().describe('Task ID'),
        status: z.enum(['open', 'accepted', 'in_progress', 'blocked', 'completed', 'cancelled']).optional().describe('New status (triggers status_changed event)'),
        body: z.string().optional().describe('Comment or status note (max 64KiB)'),
        metadata: z.record(z.unknown()).optional().describe('JSON metadata object'),
        idempotency_key: z.string().optional().describe('Optional key for idempotent retries. Auto-generated if omitted.'),
      }),
    },
    async (args) => {
      try {
        const agentId = getAgentId();
        if (!agentId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Agent not registered.' }],
            isError: true,
          };
        }

        const result = appendTaskEvent(db, agentId, args.task_id, {
          status: args.status,
          body: args.body,
          metadata: args.metadata,
          idempotency_key: args.idempotency_key ?? randomUUID(),
        });

        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // Tool 5: flock_task_artifact
  server.registerTool(
    'flock_task_artifact',
    {
      description: 'Add an artifact (text/json/code/uri) to a task. Artifacts represent task outputs or deliverables.',
      inputSchema: z.object({
        task_id: z.string().describe('Task ID'),
        type: z.enum(['text', 'json', 'code', 'uri']).describe('Artifact type'),
        name: z.string().describe('Artifact name (1-200 chars)'),
        content: z.string().optional().describe('Inline content for text/json/code (max 1MB)'),
        uri: z.string().optional().describe('URI for uri type (max 2048 chars)'),
        mime_type: z.string().optional().describe('MIME type for display'),
        metadata: z.record(z.unknown()).optional().describe('JSON metadata (e.g. {language: "typescript"} for code)'),
        idempotency_key: z.string().optional().describe('Optional key for idempotent retries. Auto-generated if omitted.'),
      }),
    },
    async (args) => {
      try {
        const agentId = getAgentId();
        if (!agentId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Agent not registered.' }],
            isError: true,
          };
        }

        const result = addTaskArtifact(db, agentId, args.task_id, {
          type: args.type,
          name: args.name,
          content: args.content,
          uri: args.uri,
          mime_type: args.mime_type,
          metadata: args.metadata,
          idempotency_key: args.idempotency_key ?? randomUUID(),
        });

        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );
}
