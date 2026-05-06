import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { getMessages } from '@flock/server/services/messaging';
import { isRoomMember } from '@flock/server/services/room';

// Track last-seen sequence per room per agent
const roomSequences = new Map<string, number>();

function getSeqKey(roomId: string, agentId: string): string {
  return `${roomId}:${agentId}`;
}

export function registerSubscribeTools(server: McpServer, db: Database.Database): void {
  // flock_subscribe: record baseline sequence (no polling)
  server.registerTool(
    'flock_subscribe',
    {
      description: 'Subscribe to a room. Call flock_wait afterward to block until new messages arrive.',
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

      if (!isRoomMember(db, room_id, agentId)) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Not a member of this room. Join first.' }],
          isError: true,
        };
      }

      // Record current latest sequence as baseline
      const current = getMessages(db, room_id, { limit: 1 });
      const lastSeq = current.messages.length > 0 ? current.messages[0].sequence : 0;
      roomSequences.set(getSeqKey(room_id, agentId), lastSeq);

      return {
        content: [{ type: 'text' as const, text: `Subscribed to room ${room_id}. Use flock_wait to block until new messages arrive.` }],
      };
    },
  );

  // flock_wait: block until new messages arrive in a subscribed room
  server.registerTool(
    'flock_wait',
    {
      description: 'Block until new messages arrive in a room. Returns new messages when available. Must call flock_subscribe first.',
      inputSchema: z.object({
        room_id: z.string().describe('The room ID to wait on'),
        timeout_seconds: z.number().optional().describe('Max seconds to wait (default 300, max 600)'),
      }),
    },
    async ({ room_id, timeout_seconds }) => {
      const agentId = process.env.AGENT_ID;
      if (!agentId) {
        return {
          content: [{ type: 'text' as const, text: 'Error: AGENT_ID not set. Register first.' }],
          isError: true,
        };
      }

      const seqKey = getSeqKey(room_id, agentId);
      const lastSeq = roomSequences.get(seqKey);
      if (lastSeq === undefined) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Not subscribed. Call flock_subscribe first.' }],
          isError: true,
        };
      }

      const timeout = Math.min(Math.max(timeout_seconds ?? 300, 1), 600);
      const pollIntervalMs = 1500;
      const maxPolls = Math.ceil((timeout * 1000) / pollIntervalMs);

      for (let i = 0; i < maxPolls; i++) {
        // Get latest messages (no cursor — cursor is exclusive < cursor, would miss baseline)
        const result = getMessages(db, room_id, { limit: 50 });
        const newMessages = result.messages.filter((m) => m.sequence > lastSeq);

        if (newMessages.length > 0) {
          // Update baseline to latest
          const maxSeq = Math.max(...newMessages.map((m) => m.sequence));
          roomSequences.set(seqKey, maxSeq);

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                messages: newMessages,
                count: newMessages.length,
              }),
            }],
          };
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      // Timeout
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ messages: [], count: 0, timed_out: true }) }],
      };
    },
  );

  // flock_unsubscribe: clear tracking
  server.registerTool(
    'flock_unsubscribe',
    {
      description: 'Unsubscribe from a room to stop waiting for messages.',
      inputSchema: z.object({
        room_id: z.string().describe('The room ID to unsubscribe from'),
      }),
    },
    async ({ room_id }) => {
      const agentId = process.env.AGENT_ID;
      if (agentId) {
        roomSequences.delete(getSeqKey(room_id, agentId));
      }

      return {
        content: [{ type: 'text' as const, text: `Unsubscribed from room ${room_id}.` }],
      };
    },
  );
}
