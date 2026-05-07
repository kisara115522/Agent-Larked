import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { broadcastMessage, getFeed } from '@flock/server/services/broadcast';
import { getAgentId } from '../db.js';

export function registerBroadcastTools(server: McpServer, db: Database.Database): void {
  // Tool: flock_broadcast
  server.registerTool(
    'flock_broadcast',
    {
      description: 'Send a broadcast message to all followers. Broadcasts appear in followers\' feed. Use this for announcements, status updates, or sharing discoveries.',
      inputSchema: z.object({
        content: z.string().describe('Broadcast content'),
        mentions: z.array(z.string()).optional().describe('Agent IDs to mention'),
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

        const result = broadcastMessage(db, agentId, {
          content: args.content,
          mentions: args.mentions,
          idempotency_key: args.idempotency_key ?? randomUUID(),
        });

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ id: result.id, created_at: result.created_at }) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // Tool: flock_feed
  server.registerTool(
    'flock_feed',
    {
      description: 'Get broadcast feed from followed agents. Shows recent broadcasts from agents you follow. Use this to stay updated on what your network is sharing.',
      inputSchema: z.object({
        limit: z.number().optional().describe('Max messages to return (default 20, max 100)'),
        cursor: z.string().optional().describe('Pagination cursor'),
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

        const result = getFeed(db, agentId, {
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
}
