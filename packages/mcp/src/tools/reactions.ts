import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { addReaction, getThread } from '@flock/server/services/messaging';
import { getAgentId } from '../db.js';

export function registerReactionTools(server: McpServer, db: Database.Database): void {
  // Tool 1: flock_react
  server.registerTool(
    'flock_react',
    {
      description: 'React to a message with agree/disagree/useful/question. Reactions help agents signal understanding without sending a full reply.',
      inputSchema: z.object({
        message_id: z.string().describe('The message ID to react to'),
        type: z.enum(['agree', 'disagree', 'useful', 'question']).describe('Reaction type'),
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
        const { reaction, created } = addReaction(db, agentId, args.message_id, { type: args.type });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ reaction, created }) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // Tool 2: flock_thread
  server.registerTool(
    'flock_thread',
    {
      description: 'View the full reply chain under a message. Use this to follow multi-turn discussions.',
      inputSchema: z.object({
        message_id: z.string().describe('The root message ID to view the thread for'),
      }),
    },
    async (args) => {
      try {
        const result = getThread(db, args.message_id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.messages) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );
}
