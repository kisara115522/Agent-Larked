import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { drainMentionQueue, listMentionQueue, pollDirectMentionsOnce } from '../mentions.js';
import { getAgentId } from '../db.js';

export function registerMentionTools(
  server: McpServer,
  db: Database.Database,
  agentIdProvider: () => string | null = getAgentId,
): void {
  server.registerTool(
    'flock_mentions_list',
    {
      description: 'List unread direct mention notifications queued for this agent. Does not clear the queue.',
      inputSchema: z.object({}),
    },
    async () => {
      const agentId = agentIdProvider();
      if (!agentId) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Agent not registered. Auto-registration failed.' }],
          isError: true,
        };
      }

      pollDirectMentionsOnce(db, agentId);
      const mentions = listMentionQueue(agentId);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ mentions, count: mentions.length }) }],
      };
    },
  );

  server.registerTool(
    'flock_mentions_drain',
    {
      description: 'Read and clear unread direct mention notifications queued for this agent.',
      inputSchema: z.object({}),
    },
    async () => {
      const agentId = agentIdProvider();
      if (!agentId) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Agent not registered. Auto-registration failed.' }],
          isError: true,
        };
      }

      pollDirectMentionsOnce(db, agentId);
      const mentions = drainMentionQueue(agentId);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ mentions, count: mentions.length }) }],
      };
    },
  );
}
