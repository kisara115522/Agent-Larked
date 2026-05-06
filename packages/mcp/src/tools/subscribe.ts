import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { getMessages } from '@flock/server/services/messaging';
import { isRoomMember } from '@flock/server/services/room';

// Track subscriptions per room
const subscriptions = new Map<string, { interval: ReturnType<typeof setInterval>; lastSequence: number }>();

export function registerSubscribeTools(server: McpServer, db: Database.Database): void {
  server.registerTool(
    'flock_subscribe',
    {
      description: 'Subscribe to a room for real-time message notifications. New messages will be sent as notifications.',
      inputSchema: z.object({
        room_id: z.string().describe('The room ID to subscribe to'),
      }),
    },
    async ({ room_id }) => {
      const agentId = process.env.AGENT_ID;
      if (!agentId) {
        return {
          content: [{ type: 'text' as const, text: 'Error: AGENT_ID not set. Register first.' }],
          isError: true,
        };
      }

      // Verify room membership
      if (!isRoomMember(db, room_id, agentId)) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Not a member of this room. Join first.' }],
          isError: true,
        };
      }

      // Already subscribed?
      if (subscriptions.has(room_id)) {
        return {
          content: [{ type: 'text' as const, text: `Already subscribed to room ${room_id}.` }],
        };
      }

      // Get current latest sequence as baseline
      const current = getMessages(db, room_id, { limit: 1 });
      const lastSequence = current.messages.length > 0 ? current.messages[0].sequence : 0;

      // Poll for new messages every 3 seconds
      const interval = setInterval(() => {
        try {
          const result = getMessages(db, room_id, { limit: 10, cursor: lastSequence });
          for (const msg of result.messages) {
            if (msg.sequence > lastSequence) {
              // Send notification
              server.sendLoggingMessage({
                level: 'info',
                data: {
                  type: 'new_message',
                  room_id,
                  message_id: msg.id,
                  from: msg.from,
                  content: msg.content,
                  sequence: msg.sequence,
                },
              });
              // Update last sequence
              const sub = subscriptions.get(room_id);
              if (sub && msg.sequence > sub.lastSequence) {
                sub.lastSequence = msg.sequence;
              }
            }
          }
        } catch {
          // Ignore poll errors (room may have been deleted, etc.)
        }
      }, 3000);

      subscriptions.set(room_id, { interval, lastSequence });

      return {
        content: [{ type: 'text' as const, text: `Subscribed to room ${room_id}. Polling for new messages every 3s.` }],
      };
    },
  );

  server.registerTool(
    'flock_unsubscribe',
    {
      description: 'Unsubscribe from a room to stop receiving message notifications.',
      inputSchema: z.object({
        room_id: z.string().describe('The room ID to unsubscribe from'),
      }),
    },
    async ({ room_id }) => {
      const sub = subscriptions.get(room_id);
      if (!sub) {
        return {
          content: [{ type: 'text' as const, text: `Not subscribed to room ${room_id}.` }],
        };
      }

      clearInterval(sub.interval);
      subscriptions.delete(room_id);

      return {
        content: [{ type: 'text' as const, text: `Unsubscribed from room ${room_id}.` }],
      };
    },
  );
}
