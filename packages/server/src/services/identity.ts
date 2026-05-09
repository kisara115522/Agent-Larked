import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { AgentProfile, RegisterAgentRequest, RegisterAgentResponse, UpdateAgentRequest } from '@flock/shared';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';
import { hashToken } from '../middleware/auth.js';
import { rowToProfile } from './profile-utils.js';
import type { EventBus } from '../sse/event-bus.js';

const STALE_ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Mark agents as offline if their last_active_at is older than the lease threshold.
 * This is a safety net for crashed hosts or hooks that didn't fire.
 * Returns IDs of agents that were marked offline (for SSE broadcasting).
 */
export function cleanupStaleOnlineAgents(db: Database.Database): string[] {
  const threshold = new Date(Date.now() - STALE_ONLINE_THRESHOLD_MS).toISOString();
  const stale = db.prepare(
    "SELECT id FROM profiles WHERE status = 'online' AND last_active_at IS NOT NULL AND last_active_at < ?"
  ).all(threshold) as Array<{ id: string }>;

  if (stale.length === 0) return [];

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE profiles SET status = 'offline', updated_at = ? WHERE status = 'online' AND last_active_at IS NOT NULL AND last_active_at < ?"
  ).run(now, threshold);

  return stale.map(a => a.id);
}

export function registerAgent(db: Database.Database, req: RegisterAgentRequest): RegisterAgentResponse {
  const id = uuidv4();
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO profiles (id, name, bio, capabilities, model, status, token_hash, created_at, updated_at, last_active_at)
      VALUES (?, ?, ?, ?, ?, 'online', ?, ?, ?, ?)
    `).run(
      id,
      req.name,
      req.bio ?? '',
      JSON.stringify(req.capabilities ?? []),
      req.model ?? '',
      tokenHash,
      now,
      now,
      now,
    );
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed: profiles.name')) {
      // Return existing agent (idempotent)
      const existing = db.prepare('SELECT id FROM profiles WHERE name = ?').get(req.name) as { id: string } | undefined;
      if (existing) {
        throw new ServerError(ErrorCode.VALIDATION_ERROR, `Agent name '${req.name}' already taken`, false, 409);
      }
    }
    throw err;
  }

  return { id, name: req.name, token };
}

export function updateProfile(db: Database.Database, agentId: string, req: UpdateAgentRequest): AgentProfile {
  const existing = db.prepare('SELECT * FROM profiles WHERE id = ?').get(agentId) as Record<string, unknown> | undefined;
  if (!existing) {
    throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Agent not found', false, 404);
  }

  const now = new Date().toISOString();
  const updates: string[] = [];
  const values: unknown[] = [];

  if (req.name !== undefined) {
    // Check uniqueness
    const conflict = db.prepare('SELECT id FROM profiles WHERE name = ? AND id != ?').get(req.name, agentId) as { id: string } | undefined;
    if (conflict) {
      throw new ServerError(ErrorCode.DUPLICATE_NAME, `Agent name '${req.name}' already taken`, false, 409);
    }
    updates.push('name = ?');
    values.push(req.name);
  }
  if (req.display_name !== undefined) {
    updates.push('display_name = ?');
    values.push(req.display_name);
  }
  if (req.bio !== undefined) {
    updates.push('bio = ?');
    values.push(req.bio);
  }
  if (req.capabilities !== undefined) {
    updates.push('capabilities = ?');
    values.push(JSON.stringify(req.capabilities));
  }
  if (req.status !== undefined) {
    updates.push('status = ?');
    values.push(req.status);
    if (req.status === 'online') {
      updates.push('last_active_at = ?');
      values.push(now);
    }
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    values.push(now);
    values.push(agentId);
    db.prepare(`UPDATE profiles SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(agentId) as Record<string, unknown>;
  return rowToProfile(row);
}

export function getProfile(db: Database.Database, agentId: string): AgentProfile {
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(agentId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new ServerError(ErrorCode.AGENT_NOT_FOUND, 'Agent not found', false, 404);
  }
  return rowToProfile(row);
}

export function searchAgents(
  db: Database.Database,
  query: { q?: string; capabilities?: string; status?: string; limit?: number; cursor?: string },
): { agents: AgentProfile[]; next_cursor: string | null; has_more: boolean } {
  const limit = Math.min(query.limit ?? 20, 100);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.q) {
    conditions.push('(name LIKE ? OR display_name LIKE ? OR bio LIKE ?)');
    params.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
  }
  if (query.capabilities) {
    const caps = query.capabilities.split(',').map((c) => c.trim());
    for (const cap of caps) {
      conditions.push('capabilities LIKE ?');
      params.push(`%"${cap}"%`);
    }
  }
  if (query.status) {
    conditions.push('status = ?');
    params.push(query.status);
  }

  // Cursor: {created_at, id} composite
  if (query.cursor) {
    try {
      const { created_at, id } = JSON.parse(Buffer.from(query.cursor, 'base64').toString()) as { created_at: string; id: string };
      conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
      params.push(created_at, created_at, id);
    } catch {
      throw new ServerError(ErrorCode.VALIDATION_ERROR, 'Invalid cursor', false, 400);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit + 1);

  const rows = db.prepare(`SELECT * FROM profiles ${where} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...params) as Record<string, unknown>[];

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(rowToProfile);

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    nextCursor = Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString('base64');
  }

  return { agents: items, next_cursor: nextCursor, has_more: hasMore };
}
