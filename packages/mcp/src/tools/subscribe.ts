import { EventEmitter } from 'node:events';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { DirectMessage } from '@flock/shared';
import { getMessages } from '@flock/server/services/messaging';
import { getLatestDirectMessageOrder, getUnreadDirectMessagesSince } from '@flock/server/services/direct-chat';
import { getAgentId } from '../db.js';

/** Get the agent's own recent status updates from joined rooms for context recovery */
function getMyStatusUpdates(
  db: Database.Database,
  agentId: string,
  roomIds: Set<string>,
  limit = 5,
): Array<{ room_id: string; content: string; created_at: string }> {
  const results: Array<{ room_id: string; content: string; created_at: string }> = [];
  for (const roomId of roomIds) {
    const rows = db.prepare(
      `SELECT room_id, content, created_at FROM messages
       WHERE room_id = ? AND from_agent = ? AND content LIKE 'Status:%'
       ORDER BY sequence DESC LIMIT ?`,
    ).all(roomId, agentId, limit) as Array<{ room_id: string; content: string; created_at: string }>;
    results.push(...rows);
  }
  results.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return results.slice(0, limit);
}

// Global message event bus — shared across all tool registrations
export const messageBus = new EventEmitter();
messageBus.setMaxListeners(100);

// Track last-seen sequence per room (global, keyed by room_id)
const roomSequences = new Map<string, number>();
const directMessageOrders = new Map<string, number>();

/** Reset global sequence baselines. For testing only. */
export function resetSequenceBaselines(): void {
  roomSequences.clear();
  directMessageOrders.clear();
}

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

export function emitNewDirectMessage(message: {
  id: string;
  chat_id: string;
  from: string;
  to: string;
  content: string;
  sequence: number;
  created_at: string;
}): void {
  messageBus.emit('direct_message', message);
}

export function registerWaitTool(
  server: McpServer,
  db: Database.Database,
  agentIdProvider: () => string | null = getAgentId,
): void {
  // flock_wait: block until new messages arrive in ANY room the agent has joined
  server.registerTool(
    'flock_wait',
    {
      description: 'Block until new messages from OTHER agents arrive in any room you have joined. Returns only messages not sent by you. Use this (not flock_read) to wait for replies after posting. Blocks without consuming tokens. Call flock_post first, then flock_wait to receive responses.',
      inputSchema: z.object({
        timeout_seconds: z.number().optional().describe('Max seconds to wait (default: no timeout, waits forever. Max 3600)'),
      }),
    },
    async ({ timeout_seconds }) => {
      const agentId = agentIdProvider();
      if (!agentId) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Agent not registered. Auto-registration failed.' }],
          isError: true,
        };
      }

      const directLastOrder = directMessageOrders.get(agentId) ?? 0;
      const alreadyDirect = getUnreadDirectMessagesSince(db, agentId, directLastOrder);
      const latestDirectOrder = getLatestDirectMessageOrder(db, agentId);
      directMessageOrders.set(agentId, latestDirectOrder);

      if (alreadyDirect.length > 0) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              messages: [],
              direct_messages: alreadyDirect,
              count: alreadyDirect.length,
            }),
          }],
        };
      }

      // Get list of rooms this agent has joined
      const joinedRooms = new Set(
        (db.prepare('SELECT room_id FROM room_members WHERE agent_id = ?').all(agentId) as Array<{ room_id: string }>)
          .map((r) => r.room_id),
      );

      if (joinedRooms.size === 0) {
        return waitForDirectMessagesOnly(db, agentId, timeout_seconds);
      }

      // timeout: 0 or undefined = wait forever (no timeout)
      const timeout = timeout_seconds && timeout_seconds > 0 ? Math.min(timeout_seconds, 3600) : 0;

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
        let maxSeq = lastSeq ?? 0;
        for (const msg of result.messages) {
          if (msg.sequence > maxSeq) maxSeq = msg.sequence;
          // Skip own messages — flock_wait is for receiving others' messages
          if (msg.from === agentId) continue;
          // First call (no baseline): return others' messages and set baseline
          // Subsequent calls: only return messages above baseline
          if (lastSeq === undefined || msg.sequence > lastSeq) {
            alreadyNew.push({ ...msg, room_id: roomId });
          }
        }
        // Initialize / update baseline
        roomSequences.set(roomId, maxSeq);
      }

      if (alreadyNew.length > 0) {
        // Update baselines to latest seen
        for (const msg of alreadyNew) {
          const prev = roomSequences.get(msg.room_id) ?? 0;
          if (msg.sequence > prev) {
            roomSequences.set(msg.room_id, msg.sequence);
          }
        }
        const statusUpdates = getMyStatusUpdates(db, agentId, joinedRooms);
        const response: Record<string, unknown> = { messages: alreadyNew, count: alreadyNew.length };
        if (statusUpdates.length > 0) {
          response.my_status_updates = statusUpdates;
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response) }],
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
        const directCollected: DirectMessage[] = [];

        const finish = (msgs: typeof collected, directMessages = directCollected) => {
          if (resolved) return;
          resolved = true;
          cleanup();
          // Update baselines
          for (const msg of msgs) {
            roomSequences.set(msg.room_id, Math.max(roomSequences.get(msg.room_id) ?? 0, msg.sequence));
          }
          const statusUpdates = getMyStatusUpdates(db, agentId, joinedRooms);
          const response: Record<string, unknown> = {
            messages: msgs,
            direct_messages: directMessages,
            count: msgs.length + directMessages.length,
          };
          if (statusUpdates.length > 0) {
            response.my_status_updates = statusUpdates;
          }
          resolve({
            content: [{ type: 'text' as const, text: JSON.stringify(response) }],
          });
        };

        const onMessage = (msg: { room_id: string; id: string; from: string; content: string; sequence: number; mentions: string[]; reply_to: string | null; created_at: string }) => {
          // Skip own messages
          if (msg.from === agentId) return;
          if (joinedRooms.has(msg.room_id)) {
            collected.push(msg);
            finish(collected);
          }
        };

        const onDirectMessage = (msg: DirectMessage) => {
          if (msg.to !== agentId || msg.from === agentId) return;
          directCollected.push(msg);
          finish(collected, directCollected);
        };

        // DB fallback: poll every 3s for messages sent via HTTP (cross-process)
        const dbPoll = setInterval(() => {
          for (const roomId of joinedRooms) {
            const lastSeq = roomSequences.get(roomId) ?? 0;
            const result = getMessages(db, roomId, { limit: 50 });
            for (const msg of result.messages) {
              if (msg.sequence > lastSeq && msg.from !== agentId) {
                collected.push({ ...msg, room_id: roomId });
              }
            }
          }
          const directLast = directMessageOrders.get(agentId) ?? 0;
          const directMessages = getUnreadDirectMessagesSince(db, agentId, directLast);
          if (directMessages.length > 0) {
            directCollected.push(...directMessages);
            directMessageOrders.set(agentId, getLatestDirectMessageOrder(db, agentId));
          }
          if (collected.length > 0) {
            finish(collected);
          } else if (directCollected.length > 0) {
            finish(collected, directCollected);
          }
        }, 3000);

        const cleanup = () => {
          if (timer) clearTimeout(timer);
          clearInterval(dbPoll);
          messageBus.off('message', onMessage);
          messageBus.off('direct_message', onDirectMessage);
        };

        messageBus.on('message', onMessage);
        messageBus.on('direct_message', onDirectMessage);

        // Timeout (0 = wait forever, use a very long timer to keep type simple)
        const timer = setTimeout(() => {
          cleanup();
          if (!resolved) {
            resolved = true;
            resolve({
              content: [{ type: 'text' as const, text: JSON.stringify({ messages: [], direct_messages: [], count: 0, timed_out: true }) }],
            });
          }
        }, timeout > 0 ? timeout * 1000 : 24 * 60 * 60 * 1000);
      });
    },
  );
}

function waitForDirectMessagesOnly(
  db: Database.Database,
  agentId: string,
  timeoutSeconds: number | undefined,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const timeout = timeoutSeconds && timeoutSeconds > 0 ? Math.min(timeoutSeconds, 3600) : 0;

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (directMessages: DirectMessage[], timedOut = false) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      directMessageOrders.set(agentId, getLatestDirectMessageOrder(db, agentId));
      resolve({
        content: [{
          type: 'text',
          text: JSON.stringify({
            messages: [],
            direct_messages: directMessages,
            count: directMessages.length,
            ...(timedOut ? { timed_out: true } : {}),
          }),
        }],
      });
    };

    const onDirectMessage = (msg: DirectMessage) => {
      if (msg.to !== agentId || msg.from === agentId) return;
      finish([msg]);
    };

    const poll = setInterval(() => {
      const last = directMessageOrders.get(agentId) ?? 0;
      const directMessages = getUnreadDirectMessagesSince(db, agentId, last);
      if (directMessages.length > 0) finish(directMessages);
    }, 3000);

    const cleanup = () => {
      clearInterval(poll);
      clearTimeout(timer);
      messageBus.off('direct_message', onDirectMessage);
    };

    messageBus.on('direct_message', onDirectMessage);
    const timer = setTimeout(() => finish([], true), timeout > 0 ? timeout * 1000 : 24 * 60 * 60 * 1000);
  });
}
