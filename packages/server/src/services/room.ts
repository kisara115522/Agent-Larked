import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { Room, CreateRoomRequest, OkResponse } from '@flock/shared';
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
