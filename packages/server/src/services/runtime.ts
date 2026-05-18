import { randomBytes, createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';

export interface RegisterRuntimeRequest {
  host: string;
  port: number;
  callback_url: string;
  capabilities?: string[];
  max_agents?: number;
}

export interface RuntimeInfo {
  id: string;
  host: string;
  port: number;
  callback_url: string;
  capabilities: string[];
  max_agents: number;
  agent_count: number;
  status: string;
  last_heartbeat_at: string | null;
  created_at: string;
  /** Only returned on registration — the plaintext secret for HMAC signing */
  callback_secret?: string;
}

export function registerRuntime(
  db: Database.Database,
  req: RegisterRuntimeRequest,
): RuntimeInfo {
  if (!req.host || !req.port || !req.callback_url) {
    throw new ServerError(ErrorCode.VALIDATION_ERROR, 'host, port, and callback_url are required', false, 400);
  }

  const id = randomBytes(16).toString('hex');
  const callbackSecret = randomBytes(32).toString('hex');
  const callbackSecretHash = createHash('sha256').update(callbackSecret).digest('hex');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO agent_runtimes (id, host, port, callback_url, callback_secret_hash, callback_secret, capabilities, max_agents, status, last_heartbeat_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'online', ?, ?)
  `).run(
    id,
    req.host,
    req.port,
    req.callback_url,
    callbackSecretHash,
    callbackSecret,
    JSON.stringify(req.capabilities ?? []),
    req.max_agents ?? 10,
    now,
    now,
  );

  return {
    id,
    host: req.host,
    port: req.port,
    callback_url: req.callback_url,
    capabilities: req.capabilities ?? [],
    max_agents: req.max_agents ?? 10,
    agent_count: 0,
    status: 'online',
    last_heartbeat_at: now,
    created_at: now,
    callback_secret: callbackSecret,
  };
}

export function listRuntimes(db: Database.Database): RuntimeInfo[] {
  const rows = db.prepare(`
    SELECT r.id, r.host, r.port, r.callback_url, r.capabilities, r.max_agents, r.status, r.last_heartbeat_at, r.created_at,
           COALESCE((SELECT COUNT(*) FROM agent_spawns s WHERE s.runtime_id = r.id AND s.status = 'active'), 0) AS agent_count
    FROM agent_runtimes r
    ORDER BY r.created_at DESC
  `).all() as Record<string, unknown>[];

  return rows.map((row) => ({
    id: row.id as string,
    host: row.host as string,
    port: row.port as number,
    callback_url: row.callback_url as string,
    capabilities: JSON.parse((row.capabilities as string) ?? '[]'),
    max_agents: row.max_agents as number,
    agent_count: row.agent_count as number,
    status: row.status as string,
    last_heartbeat_at: row.last_heartbeat_at as string | null,
    created_at: row.created_at as string,
  }));
}

export function heartbeat(db: Database.Database, runtimeId: string): { status: string; last_heartbeat_at: string } {
  const existing = db.prepare('SELECT id FROM agent_runtimes WHERE id = ?').get(runtimeId);
  if (!existing) {
    throw new ServerError(ErrorCode.RUNTIME_NOT_FOUND, 'Runtime not found', false, 404);
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE agent_runtimes SET last_heartbeat_at = ?, status = 'online' WHERE id = ?").run(now, runtimeId);

  return { status: 'online', last_heartbeat_at: now };
}

/** Heartbeat TTL: runtimes that haven't sent a heartbeat within this period are considered stale. */
const STALE_RUNTIME_TTL_MS = 60_000; // 2x default heartbeat interval (30s)

/**
 * Mark runtimes as offline if they haven't sent a heartbeat within the TTL.
 * Returns IDs of runtimes that were marked stale.
 */
export function cleanupStaleRuntimes(db: Database.Database): string[] {
  const cutoff = new Date(Date.now() - STALE_RUNTIME_TTL_MS).toISOString();
  const stale = db.prepare(
    "SELECT id FROM agent_runtimes WHERE status = 'online' AND last_heartbeat_at < ?",
  ).all(cutoff) as { id: string }[];

  if (stale.length === 0) return [];

  const ids = stale.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE agent_runtimes SET status = 'offline' WHERE id IN (${placeholders})`).run(...ids);

  // Also mark active spawns on these runtimes as error
  for (const id of ids) {
    db.prepare(
      "UPDATE agent_spawns SET status = 'error' WHERE runtime_id = ? AND status = 'active'",
    ).run(id);
  }

  return ids;
}

/**
 * Find an available online runtime for spawning.
 * Automatically cleans up stale runtimes first.
 * Returns the runtime ID or null if none available.
 */
export function selectAvailableRuntime(db: Database.Database): string | null {
  cleanupStaleRuntimes(db);

  const runtime = db.prepare(`
    SELECT r.id FROM agent_runtimes r
    WHERE r.status = 'online'
    AND (SELECT COUNT(*) FROM agent_spawns s WHERE s.runtime_id = r.id AND s.status IN ('active', 'spawning')) < r.max_agents
    ORDER BY r.last_heartbeat_at DESC
    LIMIT 1
  `).get() as { id: string } | undefined;

  return runtime?.id ?? null;
}
