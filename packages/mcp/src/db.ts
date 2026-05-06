import { createDatabase, cleanupIdempotencyKeys } from '@flock/server/db';
import { registerAgent } from '@flock/server/services/identity';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import type Database from 'better-sqlite3';

let db: Database.Database | null = null;

// Cached agent identity for this MCP server process
let cachedAgentId: string | null = null;
let cachedAgentName: string | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = process.env.DB_PATH ?? './data/agentfeed.db';
    db = createDatabase(dbPath);
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Generate a default agent name: agent-{hostname}-{4hex} */
function generateAgentName(): string {
  const host = hostname().replace(/\.local$/, '').replace(/[^a-zA-Z0-9-]/g, '');
  const suffix = randomBytes(2).toString('hex');
  return `agent-${host}-${suffix}`;
}

/**
 * Resolve agent ID by name. Looks up existing agent in DB, auto-registers if not found.
 * Caches the result for the lifetime of this process.
 */
export function resolveAgentId(database: Database.Database, name?: string): { id: string; name: string } {
  if (cachedAgentId && cachedAgentName) {
    return { id: cachedAgentId, name: cachedAgentName };
  }

  const agentName = name || process.env.AGENT_NAME || generateAgentName();

  // Try to find existing agent by name
  const existing = database.prepare('SELECT id FROM profiles WHERE name = ?').get(agentName) as { id: string } | undefined;
  if (existing) {
    cachedAgentId = existing.id;
    cachedAgentName = agentName;
    process.env.AGENT_ID = existing.id;
    return { id: existing.id, name: agentName };
  }

  // Auto-register new agent
  const result = registerAgent(database, { name: agentName });
  cachedAgentId = result.id;
  cachedAgentName = agentName;
  process.env.AGENT_ID = result.id;
  return { id: result.id, name: agentName };
}

/** Get the cached agent ID for this process. Returns null if not resolved yet. */
export function getAgentId(): string | null {
  return cachedAgentId;
}

/** Get the cached agent name for this process. Returns null if not resolved yet. */
export function getAgentName(): string | null {
  return cachedAgentName;
}
