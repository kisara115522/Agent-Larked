import { EventEmitter } from 'node:events';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { getMessages } from '@flock/server/services/messaging';

// Global message event bus — shared across all tool registrations
export const messageBus = new EventEmitter();
messageBus.setMaxListeners(100);

// Track last-seen sequence per room (global, keyed by room_id)
const roomSequences = new Map<string, number>();

/** Called by flock_post after sending a message to notify waiters */
export function emitNewMessage(roomId: string, message: {
  id: string;
  from: string;
  content: string;
  sequence: number;
  mentions: string[];
  reply_to: string | null;
  created_at: string;
}): void {
  // Emit for any active flock_wait (don't update global baseline — let each agent track its own)
  messageBus.emit('message', { room_id: roomId, ...message });
}

export function registerWaitTool(server: McpServer, db: Database.Database): void {
  // flock_wait: block until new messages arrive in ANY room the agent has joined
  server.registerTool(
    'flock_wait',
    {
      description: 'Block until new messages arrive in ANY room you have joined. Returns new messages when available. Use this (not flock_read) to wait for replies after posting. Called after flock_post to wait for responses — blocks without consuming tokens until messages arrive.',
      inputSchema: z.object({
        timeout_seconds: z.number().optional().describe('Max seconds to wait (default 300, max 600)'),
      }),
    },
    async ({ timeout_seconds }) => {
      const agentId = process.env.AGENT_ID;
      if (!agentId) {
        return {
          content: [{ type: 'text' as const, text: 'Error: AGENT_ID not set. Register first.' }],
          isError: true,
        };
      }

      // Get list of rooms this agent has joined
      const joinedRooms = new Set(
        (db.prepare('SELECT room_id FROM room_members WHERE agent_id = ?').all(agentId) as Array<{ room_id: string }>)
          .map((r) => r.room_id),
      );

      if (joinedRooms.size === 0) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Not a member of any room. Join a room first.' }],
          isError: true,
        };
      }

      const timeout = Math.min(Math.max(timeout_seconds ?? 300, 1), 600);

      // First, check for messages newer than our last-known sequence per room
      const alreadyNew: Array<{
        room_id: string;
        id: string;
        from: string;
        content: string;
        sequence: number;
        mentions: string[];
        reply_to: string | null;
        created_at: string;
      }> = [];

      for (const roomId of joinedRooms) {
        const lastSeq = roomSequences.get(roomId);
        const result = getMessages(db, roomId, { limit: 50 });
        for (const msg of result.messages) {
          // If no baseline set yet, any message is "new"; otherwise check sequence
          if (lastSeq === undefined || msg.sequence > lastSeq) {
            alreadyNew.push({ ...msg, room_id: roomId });
          }
        }
      }

      if (alreadyNew.length > 0) {
        // Update baselines to latest seen
        for (const msg of alreadyNew) {
          const prev = roomSequences.get(msg.room_id) ?? 0;
          if (msg.sequence > prev) {
            roomSequences.set(msg.room_id, msg.sequence);
          }
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ messages: alreadyNew, count: alreadyNew.length }) }],
        };
      }

      // No messages yet — block on EventEmitter + periodic DB fallback
      return new Promise((resolve) => {
        let resolved = false;

        const collected: Array<{
          room_id: string;
          id: string;
          from: string;
          content: string;
          sequence: number;
          mentions: string[];
          reply_to: string | null;
          created_at: string;
        }> = [];

        const finish = (msgs: typeof collected) => {
          if (resolved) return;
          resolved = true;
          cleanup();
          // Update baselines
          for (const msg of msgs) {
            roomSequences.set(msg.room_id, Math.max(roomSequences.get(msg.room_id) ?? 0, msg.sequence));
          }
          resolve({
            content: [{ type: 'text' as const, text: JSON.stringify({ messages: msgs, count: msgs.length }) }],
          });
        };

        const onMessage = (msg: { room_id: string; id: string; from: string; content: string; sequence: number; mentions: string[]; reply_to: string | null; created_at: string }) => {
          if (joinedRooms.has(msg.room_id)) {
            collected.push(msg);
            finish(collected);
          }
        };

        // DB fallback: poll every 3s for messages sent via HTTP (cross-process)
        const dbPoll = setInterval(() => {
          for (const roomId of joinedRooms) {
            const lastSeq = roomSequences.get(roomId) ?? 0;
            const result = getMessages(db, roomId, { limit: 50 });
            for (const msg of result.messages) {
              if (msg.sequence > lastSeq) {
                collected.push({ ...msg, room_id: roomId });
              }
            }
          }
          if (collected.length > 0) {
            finish(collected);
          }
        }, 3000);

        const cleanup = () => {
          clearTimeout(timer);
          clearInterval(dbPoll);
          messageBus.off('message', onMessage);
        };

        messageBus.on('message', onMessage);

        // Timeout
        const timer = setTimeout(() => {
          cleanup();
          if (!resolved) {
            resolved = true;
            resolve({
              content: [{ type: 'text' as const, text: JSON.stringify({ messages: [], count: 0, timed_out: true }) }],
            });
          }
        }, timeout * 1000);
      });
    },
  );
}
