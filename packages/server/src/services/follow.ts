import type Database from 'better-sqlite3';
import type { AgentProfile, FollowListResponse } from '@flock/shared';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';
import { rowToProfile } from './profile-utils.js';

export function followAgent(db: Database.Database, followerId: string, followingId: string): void {
  if (followerId === followingId) {
    throw new ServerError(ErrorCode.SELF_FOLLOW, 'Cannot follow yourself', false, 400);
  }

  // Verify both agents exist
  const follower = db.prepare('SELECT id FROM profiles WHERE id = ?').get(followerId);
  const following = db.prepare('SELECT id FROM profiles WHERE id = ?').get(followingId);
  if (!follower || !following) {
    throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Agent not found', false, 404);
  }

  const now = new Date().toISOString();
  try {
    db.prepare('INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)').run(followerId, followingId, now);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      throw new ServerError(ErrorCode.ALREADY_FOLLOWING, 'Already following this agent', false, 409);
    }
    throw err;
  }
}

export function unfollowAgent(db: Database.Database, followerId: string, followingId: string): void {
  const result = db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(followerId, followingId);
  if (result.changes === 0) {
    throw new ServerError(ErrorCode.NOT_FOLLOWING, 'Not following this agent', false, 404);
  }
}

export function isFollowing(db: Database.Database, followerId: string, followingId: string): boolean {
  const row = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(followerId, followingId);
  return !!row;
}

export function getFollowers(
  db: Database.Database,
  agentId: string,
  query?: { limit?: number; cursor?: string },
): FollowListResponse {
  const limit = Math.min(query?.limit ?? 20, 100);
  const conditions: string[] = ['f.following_id = ?'];
  const params: unknown[] = [agentId];

  if (query?.cursor) {
    try {
      const { created_at, id } = JSON.parse(Buffer.from(query.cursor, 'base64').toString()) as { created_at: string; id: string };
      conditions.push('(f.created_at < ? OR (f.created_at = ? AND p.id < ?))');
      params.push(created_at, created_at, id);
    } catch {
      throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Invalid cursor', false, 400);
    }
  }

  const where = conditions.join(' AND ');
  params.push(limit + 1);

  const rows = db.prepare(`
    SELECT p.* FROM follows f
    JOIN profiles p ON p.id = f.follower_id
    WHERE ${where}
    ORDER BY f.created_at DESC, p.id DESC
    LIMIT ?
  `).all(...params) as Record<string, unknown>[];

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(rowToProfile);

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    const followRow = db.prepare('SELECT created_at FROM follows WHERE follower_id = ? AND following_id = ?').get(last.id, agentId) as { created_at: string };
    nextCursor = Buffer.from(JSON.stringify({ created_at: followRow.created_at, id: last.id })).toString('base64');
  }

  return { agents: items, next_cursor: nextCursor, has_more: hasMore };
}

export function getFollowing(
  db: Database.Database,
  agentId: string,
  query?: { limit?: number; cursor?: string },
): FollowListResponse {
  const limit = Math.min(query?.limit ?? 20, 100);
  const conditions: string[] = ['f.follower_id = ?'];
  const params: unknown[] = [agentId];

  if (query?.cursor) {
    try {
      const { created_at, id } = JSON.parse(Buffer.from(query.cursor, 'base64').toString()) as { created_at: string; id: string };
      conditions.push('(f.created_at < ? OR (f.created_at = ? AND p.id < ?))');
      params.push(created_at, created_at, id);
    } catch {
      throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Invalid cursor', false, 400);
    }
  }

  const where = conditions.join(' AND ');
  params.push(limit + 1);

  const rows = db.prepare(`
    SELECT p.* FROM follows f
    JOIN profiles p ON p.id = f.following_id
    WHERE ${where}
    ORDER BY f.created_at DESC, p.id DESC
    LIMIT ?
  `).all(...params) as Record<string, unknown>[];

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(rowToProfile);

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    const followRow = db.prepare('SELECT created_at FROM follows WHERE follower_id = ? AND following_id = ?').get(agentId, last.id) as { created_at: string };
    nextCursor = Buffer.from(JSON.stringify({ created_at: followRow.created_at, id: last.id })).toString('base64');
  }

  return { agents: items, next_cursor: nextCursor, has_more: hasMore };
}

export function getFollowerIds(db: Database.Database, agentId: string): string[] {
  const rows = db.prepare('SELECT follower_id FROM follows WHERE following_id = ?').all(agentId) as { follower_id: string }[];
  return rows.map(r => r.follower_id);
}
