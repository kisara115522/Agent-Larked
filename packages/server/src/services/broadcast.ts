import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type {
  BroadcastRequest,
  BroadcastResponse,
  GetFeedQuery,
  GetFeedResponse,
  FeedMessage,
  ReactionSummary,
} from '@flock/shared';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';

export function broadcastMessage(
  db: Database.Database,
  agentId: string,
  req: BroadcastRequest,
): BroadcastResponse {
  // 1. Content size check (1MB)
  if (Buffer.byteLength(req.content, 'utf-8') > 1_048_576) {
    throw new ServerError(ErrorCode.MESSAGE_TOO_LARGE, 'Message exceeds 1MB limit');
  }

  // 2. Validate mentions exist
  if (req.mentions && req.mentions.length > 0) {
    const placeholders = req.mentions.map(() => '?').join(',');
    const existing = db.prepare(`SELECT id FROM profiles WHERE id IN (${placeholders})`).all(...req.mentions) as { id: string }[];
    if (existing.length !== req.mentions.length) {
      throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'One or more mentioned agents not found', false, 404);
    }
  }

  // 3. Idempotency check
  const requestHash = createHash('sha256').update(JSON.stringify(req)).digest('hex');
  const existingKey = db.prepare(
    'SELECT request_hash, response FROM idempotency_keys WHERE agent_id = ? AND key = ?',
  ).get(agentId, req.idempotency_key) as { request_hash: string; response: string } | undefined;

  if (existingKey) {
    if (existingKey.request_hash === requestHash) {
      return JSON.parse(existingKey.response) as BroadcastResponse;
    }
    throw new ServerError(ErrorCode.IDEMPOTENCY_CONFLICT, 'Idempotency key conflict', false, 409);
  }

  // 4. Insert broadcast message
  const id = uuidv4();
  const now = new Date().toISOString();

  const result = db.transaction(() => {
    // Broadcast messages use a special room_id pattern
    const broadcastRoomId = `broadcast-${agentId}`;

    // Ensure broadcast room exists
    const existingRoom = db.prepare('SELECT id FROM rooms WHERE id = ?').get(broadcastRoomId) as { id: string } | undefined;
    if (!existingRoom) {
      db.prepare(`
        INSERT INTO rooms (id, name, description, created_by, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(broadcastRoomId, `broadcast-${agentId}`, `Broadcast channel for agent ${agentId}`, agentId, now);
    }

    // Get next sequence for this broadcast room
    const seqRow = db.prepare(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS next_seq FROM messages WHERE room_id = ?',
    ).get(broadcastRoomId) as { next_seq: number };

    const orderRow = db.prepare(
      'SELECT COALESCE(MAX(created_order), 0) + 1 AS next_order FROM messages',
    ).get() as { next_order: number };

    db.prepare(`
      INSERT INTO messages (id, from_agent, room_id, content, reply_to, broadcast, sequence, created_at, created_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, agentId, broadcastRoomId, req.content, null, 1, seqRow.next_seq, now, orderRow.next_order);

    // Insert mentions
    if (req.mentions && req.mentions.length > 0) {
      const mentionStmt = db.prepare('INSERT INTO message_mentions (message_id, agent_id) VALUES (?, ?)');
      for (const mentionedId of req.mentions) {
        mentionStmt.run(id, mentionedId);
      }
    }

    // Cache idempotency key (expires in 24h)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const response: BroadcastResponse = { id, created_at: now };
    db.prepare(
      'INSERT INTO idempotency_keys (agent_id, key, request_hash, response, expires_at) VALUES (?, ?, ?, ?, ?)',
    ).run(agentId, req.idempotency_key, requestHash, JSON.stringify(response), expiresAt);

    return response;
  })();

  return result;
}

export function getFeed(
  db: Database.Database,
  agentId: string,
  query: GetFeedQuery = {},
): GetFeedResponse {
  const limit = Math.min(query.limit ?? 20, 100);
  const params: unknown[] = [agentId, agentId]; // Two placeholders: one for JOIN, one for WHERE

  // Get broadcast messages from agents that this agent follows
  let where = `WHERE m.broadcast = 1 AND m.from_agent != ?`;
  if (query.cursor !== undefined) {
    where += ' AND m.created_order < ?';
    params.push(query.cursor);
  }

  params.push(limit + 1);
  const rows = db.prepare(`
    SELECT m.* FROM messages m
    INNER JOIN follows f ON f.following_id = m.from_agent AND f.follower_id = ?
    ${where}
    ORDER BY m.created_order DESC
    LIMIT ?
  `).all(...params) as Record<string, unknown>[];

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => rowToFeedMessage(db, row));

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    nextCursor = String(items[items.length - 1].created_at);
  }

  return { messages: items, next_cursor: nextCursor, has_more: hasMore };
}

function rowToFeedMessage(db: Database.Database, row: Record<string, unknown>): FeedMessage {
  const messageId = row.id as string;

  const mentions = db.prepare(
    'SELECT agent_id FROM message_mentions WHERE message_id = ?',
  ).all(messageId) as { agent_id: string }[];

  const reactions = db.prepare(
    'SELECT type, COUNT(*) as count FROM reactions WHERE message_id = ? GROUP BY type',
  ).all(messageId) as { type: string; count: number }[];

  return {
    id: messageId,
    from: row.from_agent as string,
    content: row.content as string,
    mentions: mentions.map((m) => m.agent_id),
    reactions: reactions.map((r) => ({ type: r.type as ReactionSummary['type'], count: Number(r.count) })),
    created_at: row.created_at as string,
  };
}
