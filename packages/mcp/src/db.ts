import { createDatabase, cleanupIdempotencyKeys } from '@flock/server/db';
import { registerAgent } from '@flock/server/services/identity';
import { randomBytes, createHash } from 'node:crypto';
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

function getFlockHome(): string {
  return process.env.FLOCK_HOME || join(homedir(), '.flock');
}

function getIdentityPath(): string {
  const flockHome = getFlockHome();
  const agentName = process.env.AGENT_NAME;
  if (agentName) {
    return join(flockHome, 'agents', agentName, 'identity.json');
  }
  return join(flockHome, 'identity.json');
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
    // Defense-in-depth: treat empty DB_PATH same as unset.
    // The runtime should always pass a valid path, but if it doesn't,
    // fall back to the default rather than trying to open '' (→ CWD → SQLITE_CANTOPEN).
    const rawPath = process.env.DB_PATH || join(PROJECT_ROOT, 'data', 'agentfeed.db');
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
 * Priority: cache → AGENT_TOKEN env → identity file → DB lookup by name → auto-register
 */
export function resolveAgentId(database: Database.Database, name?: string): { id: string; name: string } {
  if (cachedAgentId && cachedAgentName) {
    return { id: cachedAgentId, name: cachedAgentName };
  }

  // When a name is explicitly provided, look up by name directly (skip identity file).
  // The identity file stores the "current process" identity, not arbitrary named agents.
  if (name) {
    const existingByName = database.prepare('SELECT id FROM profiles WHERE name = ?').get(name) as { id: string } | undefined;
    if (existingByName) {
      cachedAgentId = existingByName.id;
      cachedAgentName = name;
      process.env.AGENT_ID = existingByName.id;
      saveIdentityFile({ id: existingByName.id, name, token: '' });
      return { id: existingByName.id, name };
    }
    // Not found by name — auto-register
    const result = registerAgent(database, { name });
    cachedAgentId = result.id;
    cachedAgentName = name;
    process.env.AGENT_ID = result.id;
    saveIdentityFile({ id: result.id, name, token: result.token });
    return { id: result.id, name };
  }

  // 1. Check AGENT_TOKEN env var (set by Runtime when spawning a new session)
  //    This takes priority over the identity file to prevent identity confusion
  //    when multiple agents share the same ~/.flock/ directory.
  const agentToken = process.env.AGENT_TOKEN;
  if (agentToken) {
    const tokenHash = createHash('sha256').update(agentToken).digest('hex');
    const row = database.prepare('SELECT id, name FROM profiles WHERE token_hash = ?').get(tokenHash) as { id: string; name: string } | undefined;
    if (row) {
      cachedAgentId = row.id;
      cachedAgentName = row.name;
      process.env.AGENT_ID = row.id;
      // Update identity file for this agent
      saveIdentityFile({ id: row.id, name: row.name, token: agentToken });
      return { id: row.id, name: row.name };
    }
    // Token not found in DB — fall through to other methods
  }

  // 2. Check identity file (~/.flock/identity.json)
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

  // 3. Lookup by name in DB
  const agentName = process.env.AGENT_NAME || generateAgentName();
  const existingByName = database.prepare('SELECT id FROM profiles WHERE name = ?').get(agentName) as { id: string } | undefined;
  if (existingByName) {
    cachedAgentId = existingByName.id;
    cachedAgentName = agentName;
    process.env.AGENT_ID = existingByName.id;
    // Persist to identity file for future sessions
    saveIdentityFile({ id: existingByName.id, name: agentName, token: '' });
    return { id: existingByName.id, name: agentName };
  }

  // 4. Auto-register new agent
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

/** Set the current agent's status to active in the DB (called by PostToolUse hook). */
export function setAgentOnline(database: Database.Database): void {
  if (!cachedAgentId) return;
  const now = new Date().toISOString();
  database.prepare('UPDATE profiles SET status = ?, updated_at = ?, last_active_at = ? WHERE id = ?').run('active', now, now, cachedAgentId);
}

/** Set the current agent's status to dormant in the DB (called by Stop hook / process exit). */
export function setAgentOffline(database: Database.Database): void {
  if (!cachedAgentId) return;
  const now = new Date().toISOString();
  database.prepare('UPDATE profiles SET status = ?, updated_at = ? WHERE id = ?').run('dormant', now, cachedAgentId);
}
