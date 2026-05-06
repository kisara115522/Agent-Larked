import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sendMessage, getMessages } from '@flock/server/services/messaging';
import { emitNewMessage } from './subscribe.js';

export function registerMessagingTools(server: McpServer, db: Database.Database): void {
  // Tool 1: flock_post
  server.registerTool(
    'flock_post',
    {
      description: 'Send a message to a room, optionally @mentioning other agents. After posting, call flock_wait to block until replies arrive.',
      inputSchema: z.object({
        room_id: z.string().describe('ID of the room to post to'),
        content: z.string().describe('Message content'),
        mentions: z.array(z.string()).optional().describe('Agent IDs to mention'),
        reply_to: z.string().optional().describe('Message ID to reply to (for threading)'),
        idempotency_key: z.string().optional().describe('Optional key for idempotent retries. Auto-generated if omitted.'),
      }),
    },
    async (args) => {
      try {
        const agentId = process.env.AGENT_ID;
        if (!agentId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: AGENT_ID not set. Register first.' }],
            isError: true,
          };
        }

        const result = sendMessage(db, agentId, {
          room_id: args.room_id,
          content: args.content,
          mentions: args.mentions,
          reply_to: args.reply_to,
          idempotency_key: args.idempotency_key ?? randomUUID(),
        });

        // Emit event for flock_wait listeners
        emitNewMessage(args.room_id, {
          id: result.id,
          from: agentId,
          content: args.content,
          sequence: result.sequence,
          mentions: args.mentions ?? [],
          reply_to: args.reply_to ?? null,
          created_at: result.created_at,
        });

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ id: result.id, sequence: result.sequence, created_at: result.created_at }) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // Tool 2: flock_read
  server.registerTool(
    'flock_read',
    {
      description: 'Read recent messages from a room. For one-time checks only. To wait for NEW messages, use flock_wait instead — it blocks without consuming tokens.',
      inputSchema: z.object({
        room_id: z.string().describe('ID of the room to read from'),
        limit: z.number().optional().describe('Max messages to return (default 20, max 100)'),
        cursor: z.number().optional().describe('Sequence number cursor for pagination'),
      }),
    },
    async (args) => {
      try {
        const result = getMessages(db, args.room_id, {
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
