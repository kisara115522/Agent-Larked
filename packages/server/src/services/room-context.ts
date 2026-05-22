import type Database from 'better-sqlite3';
import type { Message, ReactionSummary } from '@flock/shared';
import { isRoomMember } from './room.js';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';

export interface AgentRoomState {
  agent_id: string;
  room_id: string;
  last_seen_sequence: number;
  last_processed_sequence: number;
  pending_since_sequence: number | null;
  rules_version_seen: number;
  status: string;
  updated_at: string;
}

export interface RoomSyncResult {
  room_id: string;
  agent_id: string;
  latest_sequence: number;
  state: AgentRoomState;
  rules: {
    version: number;
    unchanged: boolean;
    content: string | null;
  };
  unread_messages: Message[];
}

export function ensureAgentRoomState(
  db: Database.Database,
  agentId: string,
  roomId: string,
): AgentRoomState {
  const existing = db.prepare(`
    SELECT *
    FROM agent_room_state
    WHERE agent_id = ? AND room_id = ?
  `).get(agentId, roomId) as AgentRoomState | undefined;
  if (existing) return normalizeState(existing);

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO agent_room_state (
      agent_id,
      room_id,
      last_seen_sequence,
      last_processed_sequence,
      pending_since_sequence,
      rules_version_seen,
      status,
      updated_at
    ) VALUES (?, ?, 0, 0, NULL, 0, 'idle', ?)
  `).run(agentId, roomId, now);

  return {
    agent_id: agentId,
    room_id: roomId,
    last_seen_sequence: 0,
    last_processed_sequence: 0,
    pending_since_sequence: null,
    rules_version_seen: 0,
    status: 'idle',
    updated_at: now,
  };
}

export function roomSync(
  db: Database.Database,
  agentId: string,
  roomId: string,
): RoomSyncResult {
  const room = db.prepare('SELECT id, rules, rules_version FROM rooms WHERE id = ?').get(roomId) as { id: string; rules: string | null; rules_version: number | null } | undefined;
  if (!room) {
    throw new ServerError(ErrorCode.ROOM_NOT_FOUND, 'Room not found', false, 404);
  }
  if (!isRoomMember(db, roomId, agentId)) {
    throw new ServerError(ErrorCode.NOT_ROOM_MEMBER, 'Not a member of this room', false, 403);
  }

  const before = ensureAgentRoomState(db, agentId, roomId);
  const rulesVersion = Number(room.rules_version ?? 0);
  const rulesChanged = before.rules_version_seen < rulesVersion;
  const latestSequence = latestRoomSequence(db, roomId);
  const unreadRows = db.prepare(`
    SELECT sequence
    FROM messages
    WHERE room_id = ? AND sequence > ? AND from_agent != ?
    ORDER BY sequence ASC
  `).all(roomId, before.last_seen_sequence, agentId) as { sequence: number }[];

  const unread = unreadRows.length > 0
    ? getRoomMessagesBySequence(db, roomId, unreadRows.map((row) => row.sequence))
    : [];

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE agent_room_state
    SET last_seen_sequence = ?,
        last_processed_sequence = ?,
        pending_since_sequence = NULL,
        rules_version_seen = ?,
        status = 'idle',
        updated_at = ?
    WHERE agent_id = ? AND room_id = ?
  `).run(latestSequence, latestSequence, rulesVersion, now, agentId, roomId);

  return {
    room_id: roomId,
    agent_id: agentId,
    latest_sequence: latestSequence,
    state: {
      ...before,
      last_seen_sequence: latestSequence,
      last_processed_sequence: latestSequence,
      pending_since_sequence: null,
      rules_version_seen: rulesVersion,
      status: 'idle',
      updated_at: now,
    },
    rules: {
      version: rulesVersion,
      unchanged: !rulesChanged,
      content: rulesChanged ? (room.rules ?? '') : null,
    },
    unread_messages: unread,
  };
}

export function hasUnreadRoomMessages(
  db: Database.Database,
  agentId: string,
  roomId: string,
): {
  hasUnread: boolean;
  hasUnreadMessages: boolean;
  hasRulesUpdate: boolean;
  latestSequence: number;
  lastSeenSequence: number;
  rulesVersion: number;
  rulesVersionSeen: number;
} {
  const room = db.prepare('SELECT id, rules_version FROM rooms WHERE id = ?').get(roomId) as { id: string; rules_version: number | null } | undefined;
  if (!room) {
    throw new ServerError(ErrorCode.ROOM_NOT_FOUND, 'Room not found', false, 404);
  }
  if (!isRoomMember(db, roomId, agentId)) {
    throw new ServerError(ErrorCode.NOT_ROOM_MEMBER, 'Not a member of this room', false, 403);
  }

  const state = ensureAgentRoomState(db, agentId, roomId);
  const latestSequence = latestRoomSequence(db, roomId, agentId);
  const rulesVersion = Number(room.rules_version ?? 0);
  const hasUnreadMessages = latestSequence > state.last_seen_sequence;
  const hasRulesUpdate = rulesVersion > state.rules_version_seen;
  return {
    hasUnread: hasUnreadMessages || hasRulesUpdate,
    hasUnreadMessages,
    hasRulesUpdate,
    latestSequence,
    lastSeenSequence: state.last_seen_sequence,
    rulesVersion,
    rulesVersionSeen: state.rules_version_seen,
  };
}

export function markRoomPendingForAgents(
  db: Database.Database,
  roomId: string,
  sequence: number,
  senderId: string,
): void {
  const recipients = db.prepare(`
    SELECT agent_id
    FROM room_members
    WHERE room_id = ? AND agent_id != ?
  `).all(roomId, senderId) as { agent_id: string }[];

  const now = new Date().toISOString();
  for (const { agent_id } of recipients) {
    ensureAgentRoomState(db, agent_id, roomId);
    db.prepare(`
      UPDATE agent_room_state
      SET pending_since_sequence = COALESCE(pending_since_sequence, ?),
          updated_at = ?
      WHERE agent_id = ? AND room_id = ?
    `).run(sequence, now, agent_id, roomId);
  }
}

function latestRoomSequence(db: Database.Database, roomId: string, excludeAgentId?: string): number {
  const row = excludeAgentId
    ? db.prepare('SELECT COALESCE(MAX(sequence), 0) AS latest FROM messages WHERE room_id = ? AND from_agent != ?').get(roomId, excludeAgentId)
    : db.prepare('SELECT COALESCE(MAX(sequence), 0) AS latest FROM messages WHERE room_id = ?').get(roomId);
  return (row as { latest: number }).latest;
}

function getRoomMessagesBySequence(db: Database.Database, roomId: string, sequences: number[]): Message[] {
  const placeholders = sequences.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT *
    FROM messages
    WHERE room_id = ? AND sequence IN (${placeholders})
    ORDER BY sequence ASC
  `).all(roomId, ...sequences) as Record<string, unknown>[];
  return rows.map((row) => rowToMessage(db, row));
}

function normalizeState(row: AgentRoomState): AgentRoomState {
  return {
    ...row,
    last_seen_sequence: Number(row.last_seen_sequence),
    last_processed_sequence: Number(row.last_processed_sequence),
    pending_since_sequence: row.pending_since_sequence === null ? null : Number(row.pending_since_sequence),
    rules_version_seen: Number(row.rules_version_seen),
  };
}

function rowToMessage(db: Database.Database, row: Record<string, unknown>): Message {
  const messageId = row.id as string;
  const fromAgent = row.from_agent as string;
  const senderType = (row.sender_type as Message['sender_type']) ?? 'agent';

  const sender = senderType === 'human'
    ? db.prepare('SELECT username AS name, display_name FROM humans WHERE id = ?').get(fromAgent) as { name: string; display_name: string | null } | undefined
    : db.prepare('SELECT name, display_name FROM profiles WHERE id = ?').get(fromAgent) as { name: string; display_name: string | null } | undefined;

  const mentions = db.prepare('SELECT agent_id FROM message_mentions WHERE message_id = ?').all(messageId) as { agent_id: string }[];
  const reactions = db.prepare('SELECT type, COUNT(*) AS count FROM reactions WHERE message_id = ? GROUP BY type').all(messageId) as { type: string; count: number }[];

  return {
    id: messageId,
    from: fromAgent,
    from_name: sender?.name ?? '',
    from_display_name: sender?.display_name ?? '',
    sender_type: senderType,
    room_id: row.room_id as string,
    content: row.content as string,
    reply_to: row.reply_to as string | null,
    sequence: Number(row.sequence),
    mentions: mentions.map((m) => m.agent_id),
    reactions: reactions.map((r) => ({ type: r.type as ReactionSummary['type'], count: Number(r.count) })),
    created_at: row.created_at as string,
  };
}
