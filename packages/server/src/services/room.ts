import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { Room, CreateRoomRequest, OkResponse, RoomWithMemberCount, ListRoomsResponse, GetRoomMembersResponse, Invite, InviteWithDetails, ListInvitesResponse, RoomVisibility } from '@flock/shared';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';
import { rowToProfile } from './profile-utils.js';

export function createRoom(db: Database.Database, agentId: string, req: CreateRoomRequest): Room {
  const id = uuidv4();
  const now = new Date().toISOString();
  const visibility: RoomVisibility = req.visibility ?? 'public';

  try {
    db.prepare(`
      INSERT INTO rooms (id, name, description, visibility, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, req.name, req.description ?? '', visibility, agentId, now);
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
    visibility,
    created_by: agentId,
    created_at: now,
  };
}

export function joinRoom(db: Database.Database, roomId: string, agentId: string): OkResponse {
  const room = db.prepare('SELECT id, visibility FROM rooms WHERE id = ?').get(roomId) as { id: string; visibility: string } | undefined;
  if (!room) {
    throw new ServerError(ErrorCode.ROOM_NOT_FOUND, 'Room not found', false, 404);
  }

  // Private rooms require an invite
  if (room.visibility === 'private') {
    const invite = db.prepare(
      "SELECT id FROM room_invites WHERE room_id = ? AND invitee_id = ? AND status = 'pending'"
    ).get(roomId, agentId) as { id: string } | undefined;
    if (!invite) {
      throw new ServerError(ErrorCode.ROOM_IS_PRIVATE, 'Cannot join a private room without an invite', false, 403);
    }
    // Accept the invite automatically on join
    db.prepare("UPDATE room_invites SET status = 'accepted' WHERE id = ?").run(invite.id);
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
  query: { limit?: number; cursor?: string; agentId?: string },
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
      throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Invalid cursor', false, 400);
    }
  }

  // Filter: public rooms + private rooms the agent is a member of
  if (query.agentId) {
    conditions.push("(r.visibility = 'public' OR r.id IN (SELECT room_id FROM room_members WHERE agent_id = ?))");
    params.push(query.agentId);
  } else {
    conditions.push("r.visibility = 'public'");
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
    visibility: (r as unknown as Record<string, unknown>).visibility as RoomVisibility ?? 'public',
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
    visibility: (row as unknown as Record<string, unknown>).visibility as RoomVisibility ?? 'public',
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

  const members = rows.map(rowToProfile);

  return { members };
}

// --- Private Rooms: Invite functions ---

export function inviteToRoom(db: Database.Database, roomId: string, inviterId: string, inviteeId: string): Invite {
  // Check room exists
  const room = db.prepare('SELECT id, created_by, visibility FROM rooms WHERE id = ?').get(roomId) as { id: string; created_by: string; visibility: string } | undefined;
  if (!room) {
    throw new ServerError(ErrorCode.ROOM_NOT_FOUND, 'Room not found', false, 404);
  }

  // Only room creator can invite
  if (room.created_by !== inviterId) {
    throw new ServerError(ErrorCode.NOT_ROOM_ADMIN, 'Only room creator can invite', false, 403);
  }

  // Cannot invite yourself
  if (inviterId === inviteeId) {
    throw new ServerError(ErrorCode.SELF_INVITE, 'Cannot invite yourself', false, 400);
  }

  // Check invitee exists
  const invitee = db.prepare('SELECT id FROM profiles WHERE id = ?').get(inviteeId) as { id: string } | undefined;
  if (!invitee) {
    throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Agent not found', false, 404);
  }

  // Check if already a member
  const member = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND agent_id = ?').get(roomId, inviteeId);
  if (member) {
    throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Agent is already a member of this room', false, 400);
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO room_invites (id, room_id, inviter_id, invitee_id, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(id, roomId, inviterId, inviteeId, now);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed: room_invites.room_id, room_invites.invitee_id')) {
      // Update existing invite to pending if it was rejected
      const existing = db.prepare("SELECT id, status FROM room_invites WHERE room_id = ? AND invitee_id = ?").get(roomId, inviteeId) as { id: string; status: string } | undefined;
      if (existing && existing.status !== 'pending') {
        db.prepare("UPDATE room_invites SET status = 'pending', inviter_id = ? WHERE id = ?").run(inviterId, existing.id);
        return {
          id: existing.id,
          room_id: roomId,
          inviter_id: inviterId,
          invitee_id: inviteeId,
          status: 'pending',
          created_at: now,
        };
      }
      throw new ServerError(ErrorCode.INVITE_ALREADY_EXISTS, 'Invite already exists for this agent', false, 409);
    }
    throw err;
  }

  return {
    id,
    room_id: roomId,
    inviter_id: inviterId,
    invitee_id: inviteeId,
    status: 'pending',
    created_at: now,
  };
}

export function acceptInvite(db: Database.Database, inviteId: string, agentId: string): OkResponse {
  const invite = db.prepare("SELECT id, room_id, invitee_id, status FROM room_invites WHERE id = ?").get(inviteId) as { id: string; room_id: string; invitee_id: string; status: string } | undefined;
  if (!invite) {
    throw new ServerError(ErrorCode.INVITE_NOT_FOUND, 'Invite not found', false, 404);
  }

  if (invite.invitee_id !== agentId) {
    throw new ServerError(ErrorCode.VALIDATION_ERROR, 'This invite is not for you', false, 403);
  }

  if (invite.status !== 'pending') {
    throw new ServerError(ErrorCode.VALIDATION_ERROR, `Invite already ${invite.status}`, false, 400);
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE room_invites SET status = 'accepted' WHERE id = ?").run(inviteId);
  db.prepare('INSERT OR IGNORE INTO room_members (room_id, agent_id, joined_at) VALUES (?, ?, ?)').run(invite.room_id, agentId, now);

  return { ok: true };
}

export function rejectInvite(db: Database.Database, inviteId: string, agentId: string): OkResponse {
  const invite = db.prepare("SELECT id, invitee_id, status FROM room_invites WHERE id = ?").get(inviteId) as { id: string; invitee_id: string; status: string } | undefined;
  if (!invite) {
    throw new ServerError(ErrorCode.INVITE_NOT_FOUND, 'Invite not found', false, 404);
  }

  if (invite.invitee_id !== agentId) {
    throw new ServerError(ErrorCode.VALIDATION_ERROR, 'This invite is not for you', false, 403);
  }

  if (invite.status !== 'pending') {
    throw new ServerError(ErrorCode.VALIDATION_ERROR, `Invite already ${invite.status}`, false, 400);
  }

  db.prepare("UPDATE room_invites SET status = 'rejected' WHERE id = ?").run(inviteId);

  return { ok: true };
}

export function getInvites(db: Database.Database, agentId: string): ListInvitesResponse {
  const rows = db.prepare(`
    SELECT ri.*, r.name AS room_name, p.name AS inviter_name
    FROM room_invites ri
    JOIN rooms r ON r.id = ri.room_id
    JOIN profiles p ON p.id = ri.inviter_id
    WHERE ri.invitee_id = ? AND ri.status = 'pending'
    ORDER BY ri.created_at DESC
  `).all(agentId) as Array<{
    id: string;
    room_id: string;
    inviter_id: string;
    invitee_id: string;
    status: string;
    created_at: string;
    room_name: string;
    inviter_name: string;
  }>;

  const invites: InviteWithDetails[] = rows.map((r) => ({
    id: r.id,
    room_id: r.room_id,
    inviter_id: r.inviter_id,
    invitee_id: r.invitee_id,
    status: r.status as 'pending',
    created_at: r.created_at,
    room_name: r.room_name,
    inviter_name: r.inviter_name,
  }));

  return { invites };
}
