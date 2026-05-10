import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { hashToken } from '../middleware/auth.js';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';

export interface HumanUser {
  id: string;
  username: string;
  display_name: string;
  role: string;
  created_at: string;
  updated_at: string;
}

function rowToHumanUser(row: Record<string, unknown>): HumanUser {
  return {
    id: row.id as string,
    username: row.username as string,
    display_name: row.display_name as string,
    role: row.role as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function createHumanUser(
  db: Database.Database,
  input: { username: string; display_name?: string; role?: string },
): { user: HumanUser; token: string } {
  const username = input.username.trim();
  if (!username || username.length > 64) {
    throw new ServerError(ErrorCode.VALIDATION_ERROR, 'username must be 1-64 characters', false, 400);
  }
  if (!/^[\w.-]+$/.test(username)) {
    throw new ServerError(ErrorCode.VALIDATION_ERROR, 'username may only contain letters, digits, dots, hyphens, and underscores', false, 400);
  }

  const existing = db.prepare('SELECT id FROM human_users WHERE username = ?').get(username);
  if (existing) {
    throw new ServerError(ErrorCode.VALIDATION_ERROR, `username '${username}' already exists`, false, 409);
  }

  const id = randomBytes(16).toString('hex');
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();
  const display_name = input.display_name?.trim() || username;
  const role = input.role || 'admin';

  db.prepare(
    'INSERT INTO human_users (id, username, display_name, role, token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, username, display_name, role, tokenHash, now, now);

  return { user: { id, username, display_name, role, created_at: now, updated_at: now }, token };
}

export function authenticateHumanUser(
  db: Database.Database,
  input: { username: string; token: string },
): HumanUser {
  const tokenHash = hashToken(input.token);
  const row = db.prepare(
    'SELECT * FROM human_users WHERE username = ? AND token_hash = ?',
  ).get(input.username, tokenHash) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ServerError(ErrorCode.INVALID_TOKEN, 'Invalid username or token', false, 401);
  }

  return rowToHumanUser(row);
}

export function getHumanUser(db: Database.Database, id: string): HumanUser {
  const row = db.prepare('SELECT * FROM human_users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) {
    throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Human user not found', false, 404);
  }
  return rowToHumanUser(row);
}

export function listHumanUsers(db: Database.Database): HumanUser[] {
  const rows = db.prepare('SELECT * FROM human_users ORDER BY created_at ASC').all() as Array<Record<string, unknown>>;
  return rows.map(rowToHumanUser);
}

export function deleteHumanUser(db: Database.Database, id: string): void {
  const existing = db.prepare('SELECT id FROM human_users WHERE id = ?').get(id);
  if (!existing) {
    throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Human user not found', false, 404);
  }
  db.prepare('DELETE FROM human_users WHERE id = ?').run(id);
}

export function regenerateHumanUserToken(
  db: Database.Database,
  id: string,
): { id: string; token: string } {
  const existing = db.prepare('SELECT id FROM human_users WHERE id = ?').get(id);
  if (!existing) {
    throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Human user not found', false, 404);
  }

  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();

  db.prepare('UPDATE human_users SET token_hash = ?, updated_at = ? WHERE id = ?').run(tokenHash, now, id);

  return { id, token };
}

/** Verify admin token from Authorization header. Returns admin user id or null. */
export function verifyAdminToken(db: Database.Database, authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const tokenHash = hashToken(token);
  const row = db.prepare('SELECT id FROM human_users WHERE token_hash = ?').get(tokenHash) as { id: string } | undefined;
  return row?.id ?? null;
}

/** Check if a token belongs to a human admin. Returns admin user id or null. */
export function getAdminUserId(db: Database.Database, authHeader: string | undefined): string | null {
  return verifyAdminToken(db, authHeader);
}
