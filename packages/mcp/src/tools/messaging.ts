import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { wakeMentionedAgents } from '@flock/server/services/callback';
import { sendMessage, getMessages } from '@flock/server/services/messaging';
import { hasUnreadRoomMessages, markRoomPendingForAgents, roomSync } from '@flock/server/services/room-context';
import { enqueueRoomMessageForBusyAgents } from '@flock/server/services/inbox';
import { emitNewMessage } from './subscribe.js';
import { getAgentId } from '../db.js';

export function registerMessagingTools(
  server: McpServer,
  db: Database.Database,
  agentIdProvider: () => string | null = getAgentId,
): void {
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
        const agentId = agentIdProvider();
        if (!agentId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Agent not registered. Auto-registration failed.' }],
            isError: true,
          };
        }

        const unread = hasUnreadRoomMessages(db, agentId, args.room_id);
        if (unread.hasUnread) {
          const reasons = [
            unread.hasUnreadMessages ? `unread messages through sequence ${unread.latestSequence}; your last synced sequence is ${unread.lastSeenSequence}` : null,
            unread.hasRulesUpdate ? `room rules version ${unread.rulesVersion}; your last synced rules version is ${unread.rulesVersionSeen}` : null,
          ].filter(Boolean).join('; ');
          return {
            content: [{
              type: 'text' as const,
              text: `Error: room context is stale (${reasons}). Call flock_room_sync before posting.`,
            }],
            isError: true,
          };
        }

        const mentions = resolveMentions(db, args.content, args.mentions ?? [], agentId);
        const result = sendMessage(db, agentId, {
          room_id: args.room_id,
          content: args.content,
          mentions: mentions.length > 0 ? mentions : undefined,
          reply_to: args.reply_to,
          idempotency_key: args.idempotency_key ?? randomUUID(),
        });
        markRoomPendingForAgents(db, args.room_id, result.sequence, agentId);

        // Inject to inbox of busy room members (agent flock_post)
        const senderProfile = db.prepare('SELECT name FROM profiles WHERE id = ?').get(agentId) as { name: string } | undefined;
        enqueueRoomMessageForBusyAgents(db, {
          roomId: args.room_id,
          senderId: agentId,
          senderName: senderProfile?.name ?? '',
          excerpt: args.content.slice(0, 200),
          messageId: result.id,
        });

        if (mentions.length > 0) {
          wakeMentionedAgents(
            db,
            mentions,
            args.room_id,
            result.id,
            senderProfile?.name ?? '',
            args.content.slice(0, 200),
            agentId,
          );
        }

        // Emit event for flock_wait listeners
        emitNewMessage(args.room_id, {
          id: result.id,
          from: agentId,
          content: args.content,
          sequence: result.sequence,
          mentions,
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

  // Tool 2: flock_feed
  server.registerTool(
    'flock_feed',
    {
      description: 'Get a cross-room message feed for the current agent. Returns recent messages from all joined rooms, ordered by time. Use for catching up on activity.',
      inputSchema: z.object({
        limit: z.number().optional().describe('Max messages to return (default 20, max 100)'),
        cursor: z.number().optional().describe('Pagination cursor (created_order value)'),
      }),
    },
    async (args) => {
      try {
        const agentId = agentIdProvider();
        if (!agentId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Agent not registered.' }],
            isError: true,
          };
        }

        const limit = Math.min(args.limit ?? 20, 100);

        // Get all room IDs the agent has joined
        const memberRows = db.prepare(
          'SELECT room_id FROM room_members WHERE agent_id = ?',
        ).all(agentId) as { room_id: string }[];

        // Also include public rooms
        const publicRows = db.prepare(
          "SELECT id AS room_id FROM rooms WHERE visibility = 'public'",
        ).all() as { room_id: string }[];

        const roomIds = [...new Set([...memberRows.map(r => r.room_id), ...publicRows.map(r => r.room_id)])];

        if (roomIds.length === 0) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ messages: [], next_cursor: null, has_more: false }) }] };
        }

        const placeholders = roomIds.map(() => '?').join(', ');
        const params: unknown[] = [...roomIds];

        let where = `WHERE room_id IN (${placeholders})`;
        if (args.cursor !== undefined) {
          where += ' AND created_order < ?';
          params.push(args.cursor);
        }

        params.push(limit + 1);
        const rows = db.prepare(
          `SELECT m.*, r.name AS room_name FROM messages m LEFT JOIN rooms r ON r.id = m.room_id ${where} ORDER BY m.created_order DESC LIMIT ?`,
        ).all(...params) as Record<string, unknown>[];

        const hasMore = rows.length > limit;
        const items = rows.slice(0, limit).map((row) => ({
          id: row.id as string,
          room_id: row.room_id as string,
          room_name: row.room_name as string | null,
          from: row.from_agent as string,
          content: row.content as string,
          reply_to: row.reply_to as string | null,
          created_at: row.created_at as string,
          created_order: row.created_order as number,
        }));

        let nextCursor: number | null = null;
        if (hasMore && items.length > 0) {
          nextCursor = items[items.length - 1].created_order;
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ messages: items, next_cursor: nextCursor, has_more: hasMore }),
          }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // Tool 3: flock_read
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

  server.registerTool(
    'flock_room_sync',
    {
      description: 'Synchronize room context before acting. Returns unread messages since your last sync, latest sequence, and room rules version; call this before replying or doing work in a room.',
      inputSchema: z.object({
        room_id: z.string().describe('ID of the room to synchronize'),
      }),
    },
    async (args) => {
      try {
        const agentId = agentIdProvider();
        if (!agentId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Agent not registered.' }],
            isError: true,
          };
        }

        const result = roomSync(db, agentId, args.room_id);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );
}

function resolveMentions(
  _db: Database.Database,
  _content: string,
  explicitMentions: string[],
  senderId: string,
): string[] {
  const mentionIds = new Set(explicitMentions.filter((id) => id && id !== senderId));
  return Array.from(mentionIds);
}
