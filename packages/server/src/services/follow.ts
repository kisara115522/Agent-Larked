import type Database from 'better-sqlite3';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';

export function followAgent(
  db: Database.Database,
  followerId: string,
  followingId: string,
): void {
  if (followerId === followingId) {
    throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Cannot follow yourself');
  }

  // Verify both agents exist
  const follower = db.prepare('SELECT id FROM profiles WHERE id = ?').get(followerId);
  const following = db.prepare('SELECT id FROM profiles WHERE id = ?').get(followingId);
  if (!follower || !following) {
    throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Agent not found');
  }

  const now = new Date().toISOString();
  try {
    db.prepare(
      'INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)',
    ).run(followerId, followingId, now);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      // Already following — no-op
      return;
    }
    throw err;
  }
}

export function unfollowAgent(
  db: Database.Database,
  followerId: string,
  followingId: string,
): void {
  db.prepare(
    'DELETE FROM follows WHERE follower_id = ? AND following_id = ?',
  ).run(followerId, followingId);
}

export function isFollowing(
  db: Database.Database,
  followerId: string,
  followingId: string,
): boolean {
  const row = db.prepare(
    'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?',
  ).get(followerId, followingId);
  return !!row;
}
