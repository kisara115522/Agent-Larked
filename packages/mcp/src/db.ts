import { createDatabase, cleanupIdempotencyKeys } from '@flock/server/db';
import { registerAgent } from '@flock/server/services/identity';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

interface Identity {
  id: string;
  name: string;
  token: string;
}

function getIdentityPath(): string {
  const dir = process.env.FLOCK_HOME || join(homedir(), '.flock');
  return join(dir, 'identity.json');
}

function loadIdentityFile(): Identity | null {
  try {
    const raw = readFileSync(getIdentityPath(), 'utf-8').trim();
    return JSON.parse(raw) as Identity;
  } catch {
    return null;
  }
}

function saveIdentityFile(identity: Identity): void {
  const filePath = getIdentityPath();
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(identity, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

let db: Database.Database | null = null;

// Cached agent identity for this MCP server process
let cachedAgentId: string | null = null;
let cachedAgentName: string | null = null;

/** Project root: 3 levels up from packages/mcp/dist/ */
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function getDatabase(): Database.Database {
  if (!db) {
    // Always resolve to absolute path to avoid cwd-dependent behavior
    const rawPath = process.env.DB_PATH ?? join(PROJECT_ROOT, 'data', 'agentfeed.db');
    const dbPath = resolve(rawPath);
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
 *
 * Priority: cache → identity file → DB lookup by name → auto-register
 */
export function resolveAgentId(database: Database.Database, name?: string): { id: string; name: string } {
  if (cachedAgentId && cachedAgentName) {
    return { id: cachedAgentId, name: cachedAgentName };
  }

  // 1. Check identity file (~/.flock/identity.json)
  const saved = loadIdentityFile();
  if (saved) {
    // Verify the agent still exists in DB
    const existing = database.prepare('SELECT id FROM profiles WHERE id = ?').get(saved.id) as { id: string } | undefined;
    if (existing) {
      cachedAgentId = saved.id;
      cachedAgentName = saved.name;
      process.env.AGENT_ID = saved.id;
      return { id: saved.id, name: saved.name };
    }
    // Identity file exists but agent was deleted from DB — fall through to re-register
  }

  // 2. Lookup by name in DB
  const agentName = name || process.env.AGENT_NAME || generateAgentName();
  const existingByName = database.prepare('SELECT id FROM profiles WHERE name = ?').get(agentName) as { id: string } | undefined;
  if (existingByName) {
    cachedAgentId = existingByName.id;
    cachedAgentName = agentName;
    process.env.AGENT_ID = existingByName.id;
    // Persist to identity file for future sessions
    saveIdentityFile({ id: existingByName.id, name: agentName, token: '' });
    return { id: existingByName.id, name: agentName };
  }

  // 3. Auto-register new agent
  const result = registerAgent(database, { name: agentName });
  cachedAgentId = result.id;
  cachedAgentName = agentName;
  process.env.AGENT_ID = result.id;
  // Persist to identity file
  saveIdentityFile({ id: result.id, name: agentName, token: result.token });
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

/** Set cached agent ID and name. Called after manual flock_register. */
export function setAgentId(id: string, name: string): void {
  cachedAgentId = id;
  cachedAgentName = name;
  process.env.AGENT_ID = id;
}

/** Reset cached agent state. For testing only. */
export function resetAgentCache(): void {
  cachedAgentId = null;
  cachedAgentName = null;
}

/** Set the current agent's status to online in the DB. */
export function setAgentOnline(database: Database.Database): void {
  if (!cachedAgentId) return;
  const now = new Date().toISOString();
  database.prepare('UPDATE profiles SET status = ?, updated_at = ?, last_active_at = ? WHERE id = ?').run('online', now, now, cachedAgentId);
}

/** Set the current agent's status to offline in the DB. */
export function setAgentOffline(database: Database.Database): void {
  if (!cachedAgentId) return;
  const now = new Date().toISOString();
  database.prepare('UPDATE profiles SET status = ?, updated_at = ? WHERE id = ?').run('offline', now, cachedAgentId);
}
