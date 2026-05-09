import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type {
  DirectMessage,
  GetDirectMessagesQuery,
  GetDirectMessagesResponse,
  ListDirectChatsResponse,
  SendDirectMessageRequest,
  SendDirectMessageResponse,
} from '@flock/shared';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';

interface DirectChatRow {
  id: string;
  agent_low_id: string;
  agent_high_id: string;
  created_at: string;
  updated_at: string;
}

function ensurePeer(db: Database.Database, agentId: string, peerId: string): void {
  if (agentId === peerId) {
    throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Cannot direct message yourself', false, 400);
  }
  const peer = db.prepare('SELECT id FROM profiles WHERE id = ?').get(peerId) as { id: string } | undefined;
  if (!peer) {
    throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Agent not found', false, 404);
  }
}

function canonicalPair(a: string, b: string): { low: string; high: string } {
  return a < b ? { low: a, high: b } : { low: b, high: a };
}

function getOrCreateChat(db: Database.Database, agentId: string, peerId: string): DirectChatRow {
  const { low, high } = canonicalPair(agentId, peerId);
  const existing = db.prepare(
    'SELECT * FROM direct_chats WHERE agent_low_id = ? AND agent_high_id = ?',
  ).get(low, high) as DirectChatRow | undefined;
  if (existing) return existing;

  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO direct_chats (id, agent_low_id, agent_high_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, low, high, now, now);

  return { id, agent_low_id: low, agent_high_id: high, created_at: now, updated_at: now };
}

export function sendDirectMessage(
  db: Database.Database,
  agentId: string,
  peerId: string,
  req: SendDirectMessageRequest,
): SendDirectMessageResponse {
  ensurePeer(db, agentId, peerId);

  if (Buffer.byteLength(req.content, 'utf-8') > 1_048_576) {
    throw new ServerError(ErrorCode.MESSAGE_TOO_LARGE, 'Message exceeds 1MB limit');
  }

  const requestHash = createHash('sha256')
    .update(JSON.stringify({ peer_id: peerId, content: req.content }))
    .digest('hex');
  const existingKey = db.prepare(
    'SELECT request_hash, response FROM direct_idempotency_keys WHERE agent_id = ? AND peer_id = ? AND key = ?',
  ).get(agentId, peerId, req.idempotency_key) as { request_hash: string; response: string } | undefined;

  if (existingKey) {
    if (existingKey.request_hash === requestHash) {
      return JSON.parse(existingKey.response) as SendDirectMessageResponse;
    }
    throw new ServerError(ErrorCode.IDEMPOTENCY_CONFLICT, 'Idempotency key conflict', false, 409);
  }

  return db.transaction(() => {
    const chat = getOrCreateChat(db, agentId, peerId);
    const id = uuidv4();
    const now = new Date().toISOString();
    const sequence = (db.prepare(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS next_seq FROM direct_messages WHERE chat_id = ?',
    ).get(chat.id) as { next_seq: number }).next_seq;
    const createdOrder = (db.prepare(
      'SELECT COALESCE(MAX(created_order), 0) + 1 AS next_order FROM direct_messages',
    ).get() as { next_order: number }).next_order;

    db.prepare(`
      INSERT INTO direct_messages (id, chat_id, from_agent, to_agent, content, sequence, created_at, created_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, chat.id, agentId, peerId, req.content, sequence, now, createdOrder);

    db.prepare('UPDATE direct_chats SET updated_at = ? WHERE id = ?').run(now, chat.id);

    const response: SendDirectMessageResponse = { id, chat_id: chat.id, sequence, created_at: now };
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO direct_idempotency_keys (agent_id, peer_id, key, request_hash, response, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(agentId, peerId, req.idempotency_key, requestHash, JSON.stringify(response), expiresAt);

    return response;
  })();
}

export function getDirectMessages(
  db: Database.Database,
  agentId: string,
  peerId: string,
  query: GetDirectMessagesQuery = {},
): GetDirectMessagesResponse {
  ensurePeer(db, agentId, peerId);
  const chat = getOrCreateChat(db, agentId, peerId);
  const limit = Math.min(query.limit ?? 20, 100);
  const params: unknown[] = [chat.id];

  let where = 'WHERE chat_id = ?';
  if (query.cursor !== undefined) {
    where += ' AND sequence < ?';
    params.push(query.cursor);
  }

  params.push(limit + 1);
  const rows = db.prepare(
    `SELECT * FROM direct_messages ${where} ORDER BY sequence DESC LIMIT ?`,
  ).all(...params) as Record<string, unknown>[];

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => rowToDirectMessage(db, row));
  const now = new Date().toISOString();
  db.prepare('UPDATE direct_messages SET read_at = ? WHERE chat_id = ? AND to_agent = ? AND read_at IS NULL')
    .run(now, chat.id, agentId);

  return {
    messages: items,
    next_cursor: hasMore && items.length > 0 ? items[items.length - 1].sequence : null,
    has_more: hasMore,
  };
}

export function listDirectChats(db: Database.Database, agentId: string): ListDirectChatsResponse {
  const chats = db.prepare(`
    SELECT * FROM direct_chats
    WHERE agent_low_id = ? OR agent_high_id = ?
    ORDER BY updated_at DESC
  `).all(agentId, agentId) as DirectChatRow[];

  return {
    chats: chats.map((chat) => {
      const peerId = chat.agent_low_id === agentId ? chat.agent_high_id : chat.agent_low_id;
      const peer = db.prepare('SELECT name, display_name, status FROM profiles WHERE id = ?').get(peerId) as {
        name: string;
        display_name: string | null;
        status: 'online' | 'busy' | 'idle' | 'offline';
      };
      const lastRow = db.prepare(
        'SELECT * FROM direct_messages WHERE chat_id = ? ORDER BY sequence DESC LIMIT 1',
      ).get(chat.id) as Record<string, unknown> | undefined;
      const unread = db.prepare(
        'SELECT COUNT(*) AS count FROM direct_messages WHERE chat_id = ? AND to_agent = ? AND read_at IS NULL',
      ).get(chat.id, agentId) as { count: number };

      return {
        chat_id: chat.id,
        peer_id: peerId,
        peer_name: peer.name,
        peer_display_name: peer.display_name ?? '',
        peer_status: peer.status,
        unread_count: Number(unread.count),
        last_message: lastRow ? rowToDirectMessage(db, lastRow) : null,
        updated_at: chat.updated_at,
      };
    }),
  };
}

export function getUnreadDirectMessagesSince(
  db: Database.Database,
  agentId: string,
  afterCreatedOrder: number,
): DirectMessage[] {
  const rows = db.prepare(`
    SELECT * FROM direct_messages
    WHERE to_agent = ? AND created_order > ?
    ORDER BY created_order ASC
    LIMIT 50
  `).all(agentId, afterCreatedOrder) as Record<string, unknown>[];

  return rows.map((row) => rowToDirectMessage(db, row));
}

export function getLatestDirectMessageOrder(db: Database.Database, agentId: string): number {
  const row = db.prepare(`
    SELECT COALESCE(MAX(created_order), 0) AS latest
    FROM direct_messages
    WHERE to_agent = ? OR from_agent = ?
  `).get(agentId, agentId) as { latest: number };
  return Number(row.latest);
}

function rowToDirectMessage(db: Database.Database, row: Record<string, unknown>): DirectMessage {
  const from = row.from_agent as string;
  const to = row.to_agent as string;
  const fromProfile = db.prepare('SELECT name, display_name FROM profiles WHERE id = ?').get(from) as {
    name: string;
    display_name: string | null;
  } | undefined;
  const toProfile = db.prepare('SELECT name, display_name FROM profiles WHERE id = ?').get(to) as {
    name: string;
    display_name: string | null;
  } | undefined;

  return {
    id: row.id as string,
    chat_id: row.chat_id as string,
    from,
    from_name: fromProfile?.name ?? '',
    from_display_name: fromProfile?.display_name ?? '',
    to,
    to_name: toProfile?.name ?? '',
    to_display_name: toProfile?.display_name ?? '',
    content: row.content as string,
    sequence: row.sequence as number,
    read_at: row.read_at as string | null,
    created_at: row.created_at as string,
  };
}
