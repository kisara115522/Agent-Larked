import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type {
  SendMessageRequest,
  SendMessageResponse,
  GetMessagesQuery,
  GetMessagesResponse,
  Message,
  Reaction,
  SendReactionRequest,
  GetThreadResponse,
  ReactionSummary,
} from '@flock/shared';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';
import { isRoomMember } from './room.js';

export function sendMessage(
  db: Database.Database,
  agentId: string,
  req: SendMessageRequest,
  senderType: 'agent' | 'human' = 'agent',
): SendMessageResponse {
  // 1. Room must exist
  const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(req.room_id);
  if (!room) {
    throw new ServerError(ErrorCode.ROOM_NOT_FOUND, 'Room not found', false, 404);
  }

  // 2. Must be room member
  if (!isRoomMember(db, req.room_id, agentId)) {
    throw new ServerError(ErrorCode.NOT_ROOM_MEMBER, 'Not a member of this room', false, 403);
  }

  // 3. Content size check (1MB)
  if (Buffer.byteLength(req.content, 'utf-8') > 1_048_576) {
    throw new ServerError(ErrorCode.MESSAGE_TOO_LARGE, 'Message exceeds 1MB limit');
  }

  // 4. Validate mentions exist
  if (req.mentions && req.mentions.length > 0) {
    const placeholders = req.mentions.map(() => '?').join(',');
    const existing = db.prepare(`SELECT id FROM profiles WHERE id IN (${placeholders})`).all(...req.mentions) as { id: string }[];
    if (existing.length !== req.mentions.length) {
      throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'One or more mentioned agents not found');
    }
  }

  // 5. Validate reply_to (same room, no cycle)
  if (req.reply_to) {
    const parent = db.prepare('SELECT room_id FROM messages WHERE id = ?').get(req.reply_to) as { room_id: string } | undefined;
    if (!parent) {
      throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Reply target message not found');
    }
    if (parent.room_id !== req.room_id) {
      throw new ServerError(ErrorCode.CROSS_ROOM_REPLY, 'Cross-room reply not allowed');
    }
    // Cycle detection: walk reply_to chain
    if (hasCycle(db, req.reply_to)) {
      throw new ServerError(ErrorCode.THREAD_CYCLE, 'Thread reply would create a cycle');
    }
  }

  // 6. Idempotency check
  const requestHash = createHash('sha256').update(JSON.stringify(req)).digest('hex');
  const existingKey = db.prepare(
    'SELECT request_hash, response FROM idempotency_keys WHERE agent_id = ? AND key = ?',
  ).get(agentId, req.idempotency_key) as { request_hash: string; response: string } | undefined;

  if (existingKey) {
    if (existingKey.request_hash === requestHash) {
      // Same key + same body → return cached response
      return JSON.parse(existingKey.response) as SendMessageResponse;
    }
    // Same key + different body → conflict
    throw new ServerError(ErrorCode.IDEMPOTENCY_CONFLICT, 'Idempotency key conflict', false, 409);
  }

  // 7. Generate sequence + created_order (atomic via BEGIN IMMEDIATE)
  const id = uuidv4();
  const now = new Date().toISOString();

  const result = db.transaction(() => {
    const seqRow = db.prepare(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS next_seq FROM messages WHERE room_id = ?',
    ).get(req.room_id) as { next_seq: number };

    const orderRow = db.prepare(
      'SELECT COALESCE(MAX(created_order), 0) + 1 AS next_order FROM messages',
    ).get() as { next_order: number };

    const sequence = seqRow.next_seq;
    const createdOrder = orderRow.next_order;

    db.prepare(`
      INSERT INTO messages (id, from_agent, room_id, content, reply_to, sequence, created_at, created_order, sender_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, agentId, req.room_id, req.content, req.reply_to ?? null, sequence, now, createdOrder, senderType);

    // Insert mentions
    if (req.mentions && req.mentions.length > 0) {
      const mentionStmt = db.prepare('INSERT INTO message_mentions (message_id, agent_id) VALUES (?, ?)');
      for (const mentionedId of req.mentions) {
        mentionStmt.run(id, mentionedId);
      }
    }

    // Cache idempotency key (expires in 24h)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const response: SendMessageResponse = { id, sequence, created_at: now };
    db.prepare(
      'INSERT INTO idempotency_keys (agent_id, key, request_hash, response, expires_at) VALUES (?, ?, ?, ?, ?)',
    ).run(agentId, req.idempotency_key, requestHash, JSON.stringify(response), expiresAt);

    return response;
  })();

  return result;
}

export function getMessages(
  db: Database.Database,
  roomId: string,
  query: GetMessagesQuery = {},
  agentId?: string,
): GetMessagesResponse {
  // Check room exists and get visibility
  const room = db.prepare('SELECT id, visibility FROM rooms WHERE id = ?').get(roomId) as { id: string; visibility: string } | undefined;
  if (!room) {
    throw new ServerError(ErrorCode.ROOM_NOT_FOUND, 'Room not found', false, 404);
  }

  // Private rooms require membership
  if (room.visibility === 'private' && agentId && !isRoomMember(db, roomId, agentId)) {
    throw new ServerError(ErrorCode.NOT_ROOM_MEMBER, 'Not a member of this private room', false, 403);
  }

  const limit = Math.min(query.limit ?? 20, 100);
  const params: unknown[] = [roomId];

  let where = 'WHERE room_id = ?';
  if (query.cursor !== undefined) {
    where += ' AND sequence < ?';
    params.push(query.cursor);
  }

  params.push(limit + 1);
  const rows = db.prepare(
    `SELECT * FROM messages ${where} ORDER BY sequence DESC LIMIT ?`,
  ).all(...params) as Record<string, unknown>[];

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => rowToMessage(db, row));

  let nextCursor: number | null = null;
  if (hasMore && items.length > 0) {
    nextCursor = items[items.length - 1].sequence;
  }

  return { messages: items, next_cursor: nextCursor, has_more: hasMore };
}

export function getThread(db: Database.Database, messageId: string): GetThreadResponse {
  // Recursive CTE to find all descendants
  const rows = db.prepare(`
    WITH RECURSIVE thread AS (
      SELECT * FROM messages WHERE id = ?
      UNION ALL
      SELECT m.* FROM messages m JOIN thread t ON m.reply_to = t.id
    )
    SELECT * FROM thread ORDER BY created_order ASC LIMIT 100
  `).all(messageId) as Record<string, unknown>[];

  return { messages: rows.map((row) => rowToMessage(db, row)) };
}

export function addReaction(
  db: Database.Database,
  agentId: string,
  messageId: string,
  req: SendReactionRequest,
): { reaction: Reaction; created: boolean } {
  // Message must exist
  const msg = db.prepare('SELECT id FROM messages WHERE id = ?').get(messageId);
  if (!msg) {
    throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Message not found', false, 404);
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO reactions (id, message_id, agent_id, type, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, messageId, agentId, req.type, now);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      // Duplicate reaction → return existing
      const existing = db.prepare(
        'SELECT * FROM reactions WHERE message_id = ? AND agent_id = ? AND type = ?',
      ).get(messageId, agentId, req.type) as Record<string, unknown>;
      return {
        reaction: {
          id: existing.id as string,
          message_id: existing.message_id as string,
          agent_id: existing.agent_id as string,
          type: existing.type as Reaction['type'],
          created_at: existing.created_at as string,
        },
        created: false,
      };
    }
    throw err;
  }

  return { reaction: { id, message_id: messageId, agent_id: agentId, type: req.type, created_at: now }, created: true };
}

function hasCycle(db: Database.Database, replyToId: string): boolean {
  const visited = new Set<string>();
  let current: string | null = replyToId;

  while (current) {
    if (visited.has(current)) return true;
    visited.add(current);

    const row = db.prepare('SELECT reply_to FROM messages WHERE id = ?').get(current) as { reply_to: string | null } | undefined;
    if (!row) break;
    current = row.reply_to;
  }

  return false;
}

function rowToMessage(db: Database.Database, row: Record<string, unknown>): Message {
  const messageId = row.id as string;
  const fromAgent = row.from_agent as string;

  // Get sender profile
  const profile = db.prepare(
    'SELECT name, display_name FROM profiles WHERE id = ?',
  ).get(fromAgent) as { name: string; display_name: string | null } | undefined;

  // Get mentions
  const mentions = db.prepare(
    'SELECT agent_id FROM message_mentions WHERE message_id = ?',
  ).all(messageId) as { agent_id: string }[];

  // Get reaction summaries
  const reactions = db.prepare(
    'SELECT type, COUNT(*) as count FROM reactions WHERE message_id = ? GROUP BY type',
  ).all(messageId) as { type: string; count: number }[];

  return {
    id: messageId,
    from: fromAgent,
    from_name: profile?.name ?? '',
    from_display_name: profile?.display_name ?? '',
    sender_type: (row.sender_type as 'agent' | 'human') ?? 'agent',
    room_id: row.room_id as string,
    content: row.content as string,
    reply_to: row.reply_to as string | null,
    sequence: row.sequence as number,
    mentions: mentions.map((m) => m.agent_id),
    reactions: reactions.map((r) => ({ type: r.type as ReactionSummary['type'], count: Number(r.count) })),
    created_at: row.created_at as string,
  };
}
