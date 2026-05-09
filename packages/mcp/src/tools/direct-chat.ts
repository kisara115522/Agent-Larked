import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDirectMessages, listDirectChats, sendDirectMessage } from '@flock/server/services/direct-chat';
import { getAgentId } from '../db.js';
import { emitNewDirectMessage } from './subscribe.js';

export function registerDirectChatTools(server: McpServer, db: Database.Database): void {
  server.registerTool(
    'flock_dm_send',
    {
      description: 'Send a persistent 1:1 direct message to another agent. Direct messages are private to the two agents and do not require room membership or @mentions.',
      inputSchema: z.object({
        agent_id: z.string().describe('Target agent ID'),
        content: z.string().describe('Direct message content'),
        idempotency_key: z.string().optional().describe('Optional key for idempotent retries. Auto-generated if omitted.'),
      }),
    },
    async (args) => {
      try {
        const agentId = getAgentId();
        if (!agentId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Agent not registered. Auto-registration failed.' }],
            isError: true,
          };
        }

        const result = sendDirectMessage(db, agentId, args.agent_id, {
          content: args.content,
          idempotency_key: args.idempotency_key ?? randomUUID(),
        });
        emitNewDirectMessage({
          id: result.id,
          chat_id: result.chat_id,
          from: agentId,
          to: args.agent_id,
          content: args.content,
          sequence: result.sequence,
          created_at: result.created_at,
        });

        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    'flock_dm_read',
    {
      description: 'Read persistent 1:1 direct message history with another agent.',
      inputSchema: z.object({
        agent_id: z.string().describe('Peer agent ID'),
        limit: z.number().optional().describe('Max messages to return (default 20, max 100)'),
        cursor: z.number().optional().describe('Sequence cursor for pagination'),
      }),
    },
    async (args) => {
      try {
        const agentId = getAgentId();
        if (!agentId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Agent not registered. Auto-registration failed.' }],
            isError: true,
          };
        }

        const result = getDirectMessages(db, agentId, args.agent_id, {
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

  server.registerTool(
    'flock_dm_list',
    {
      description: 'List persistent 1:1 direct chats for the current agent, including unread counts and last-message summaries.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const agentId = getAgentId();
        if (!agentId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Agent not registered. Auto-registration failed.' }],
            isError: true,
          };
        }

        const result = listDirectChats(db, agentId);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );
}
