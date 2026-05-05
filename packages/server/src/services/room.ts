import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { Room, CreateRoomRequest, OkResponse, RoomWithMemberCount, ListRoomsResponse, GetRoomMembersResponse, AgentProfile } from '@flock/shared';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';

export function createRoom(db: Database.Database, agentId: string, req: CreateRoomRequest): Room {
  const id = uuidv4();
  const now = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO rooms (id, name, description, created_by, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, req.name, req.description ?? '', agentId, now);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed: rooms.name')) {
      throw new ServerError(ErrorCode.ROOM_ALREADY_EXISTS, `Room '${req.name}' already exists`, false, 409);
    }
    throw err;
  }

  // Creator auto-joins
  db.prepare('INSERT INTO room_members (room_id, agent_id, joined_at) VALUES (?, ?, ?)').run(id, agentId, now);

  return {
    id,
    name: req.name,
    description: req.description ?? '',
    created_by: agentId,
    created_at: now,
  };
}

export function joinRoom(db: Database.Database, roomId: string, agentId: string): OkResponse {
  const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
  if (!room) {
    throw new ServerError(ErrorCode.ROOM_NOT_FOUND, 'Room not found', false, 404);
  }

  const now = new Date().toISOString();
  // Idempotent: INSERT OR IGNORE
  db.prepare('INSERT OR IGNORE INTO room_members (room_id, agent_id, joined_at) VALUES (?, ?, ?)').run(roomId, agentId, now);

  return { ok: true };
}

export function leaveRoom(db: Database.Database, roomId: string, agentId: string): OkResponse {
  const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
  if (!room) {
    throw new ServerError(ErrorCode.ROOM_NOT_FOUND, 'Room not found', false, 404);
  }

  db.prepare('DELETE FROM room_members WHERE room_id = ? AND agent_id = ?').run(roomId, agentId);
  return { ok: true };
}

export function isRoomMember(db: Database.Database, roomId: string, agentId: string): boolean {
  const row = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND agent_id = ?').get(roomId, agentId);
  return !!row;
}

export function listRooms(
  db: Database.Database,
  query: { limit?: number; cursor?: string },
): ListRoomsResponse {
  const limit = Math.min(query.limit ?? 20, 100);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.cursor) {
    try {
      const { created_at, id } = JSON.parse(Buffer.from(query.cursor, 'base64').toString()) as { created_at: string; id: string };
      conditions.push('(r.created_at < ? OR (r.created_at = ? AND r.id < ?))');
      params.push(created_at, created_at, id);
    } catch {
      // invalid cursor, ignore
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit + 1);

  const rows = db.prepare(`
    SELECT r.*, COUNT(rm.agent_id) AS member_count
    FROM rooms r
    LEFT JOIN room_members rm ON rm.room_id = r.id
    ${where}
    GROUP BY r.id
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ?
  `).all(...params) as (Room & { member_count: number })[];

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    created_by: r.created_by,
    created_at: r.created_at,
    member_count: r.member_count,
  }));

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    nextCursor = Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString('base64');
  }

  return { rooms: items, next_cursor: nextCursor, has_more: hasMore };
}

export function getRoom(db: Database.Database, roomId: string): RoomWithMemberCount {
  const row = db.prepare(`
    SELECT r.*, COUNT(rm.agent_id) AS member_count
    FROM rooms r
    LEFT JOIN room_members rm ON rm.room_id = r.id
    WHERE r.id = ?
    GROUP BY r.id
  `).get(roomId) as (Room & { member_count: number }) | undefined;

  if (!row) {
    throw new ServerError(ErrorCode.ROOM_NOT_FOUND, 'Room not found', false, 404);
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    created_by: row.created_by,
    created_at: row.created_at,
    member_count: row.member_count,
  };
}

export function getRoomMembers(db: Database.Database, roomId: string): GetRoomMembersResponse {
  const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
  if (!room) {
    throw new ServerError(ErrorCode.ROOM_NOT_FOUND, 'Room not found', false, 404);
  }

  const rows = db.prepare(`
    SELECT p.* FROM profiles p
    INNER JOIN room_members rm ON rm.agent_id = p.id
    WHERE rm.room_id = ?
    ORDER BY rm.joined_at ASC
  `).all(roomId) as Record<string, unknown>[];

  const members: AgentProfile[] = rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    bio: row.bio as string,
    capabilities: JSON.parse(row.capabilities as string) as string[],
    model: row.model as string,
    owner: row.owner as string,
    status: row.status as AgentProfile['status'],
    metadata: JSON.parse(row.metadata as string) as Record<string, unknown>,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }));

  return { members };
}
