import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  capabilities TEXT DEFAULT '[]',
  model TEXT DEFAULT '',
  owner TEXT DEFAULT '',
  status TEXT DEFAULT 'offline',
  metadata TEXT DEFAULT '{}',
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_active_at TEXT,
  is_admin INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  visibility TEXT DEFAULT 'public',
  created_by TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (room_id, agent_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  from_agent TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  reply_to TEXT REFERENCES messages(id) ON DELETE SET NULL,
  broadcast INTEGER DEFAULT 0,
  sequence INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_order INTEGER NOT NULL,
  UNIQUE(room_id, sequence),
  UNIQUE(created_order)
);

CREATE INDEX IF NOT EXISTS idx_messages_room_seq ON messages(room_id, sequence);
CREATE INDEX IF NOT EXISTS idx_messages_reply ON messages(reply_to);

CREATE TABLE IF NOT EXISTS message_mentions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_mentions_agent ON message_mentions(agent_id);

CREATE TABLE IF NOT EXISTS reactions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(message_id, agent_id, type)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  agent_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON idempotency_keys(expires_at);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

CREATE TABLE IF NOT EXISTS room_invites (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  inviter_id TEXT NOT NULL REFERENCES profiles(id),
  invitee_id TEXT NOT NULL REFERENCES profiles(id),
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL,
  UNIQUE(room_id, invitee_id)
);

CREATE INDEX IF NOT EXISTS idx_invites_invitee ON room_invites(invitee_id);
CREATE INDEX IF NOT EXISTS idx_invites_room ON room_invites(room_id);

CREATE TABLE IF NOT EXISTS direct_chats (
  id TEXT PRIMARY KEY,
  agent_low_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  agent_high_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(agent_low_id, agent_high_id),
  CHECK(agent_low_id < agent_high_id)
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES direct_chats(id) ON DELETE CASCADE,
  from_agent TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_agent TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  read_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL,
  created_order INTEGER NOT NULL,
  UNIQUE(chat_id, sequence),
  UNIQUE(created_order)
);

CREATE TABLE IF NOT EXISTS direct_idempotency_keys (
  agent_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  peer_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, peer_id, key)
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_chat_seq ON direct_messages(chat_id, sequence);
CREATE INDEX IF NOT EXISTS idx_direct_messages_to_agent ON direct_messages(to_agent, created_order);
CREATE INDEX IF NOT EXISTS idx_direct_messages_from_agent ON direct_messages(from_agent, created_order);
CREATE INDEX IF NOT EXISTS idx_direct_idempotency_expiry ON direct_idempotency_keys(expires_at);

CREATE TABLE IF NOT EXISTS human_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export function createDatabase(path: string = ':memory:'): Database.Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA_SQL);

  // Migrations for existing databases
  migrateColumn(db, 'profiles', 'display_name', 'TEXT DEFAULT \'\'');
  migrateColumn(db, 'rooms', 'visibility', "TEXT DEFAULT 'public'");
  migrateColumn(db, 'messages', 'broadcast', 'INTEGER DEFAULT 0');
  migrateColumn(db, 'profiles', 'last_active_at', 'TEXT');
  migrateColumn(db, 'profiles', 'is_admin', 'INTEGER DEFAULT 0');
  migrateColumn(db, 'direct_messages', 'read_at', 'TEXT DEFAULT NULL');

  // Index for broadcast queries
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_broadcast ON messages(broadcast, created_order)');

  return db;
}

function migrateColumn(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function cleanupIdempotencyKeys(db: Database.Database): number {
  const roomResult = db.prepare("DELETE FROM idempotency_keys WHERE expires_at < datetime('now')").run();
  const directResult = db.prepare("DELETE FROM direct_idempotency_keys WHERE expires_at < datetime('now')").run();
  return roomResult.changes + directResult.changes;
}

/** Bootstrap default admin agent 'kisara'. Returns the agent token if newly created. */
export function bootstrapDefaultAdmin(db: Database.Database, hashToken: (token: string) => string): string | null {
  const now = new Date().toISOString();
  const existingAdmin = db.prepare('SELECT id FROM profiles WHERE name = ?').get('kisara') as { id: string } | undefined;

  if (existingAdmin) {
    db.prepare('UPDATE profiles SET is_admin = 1, updated_at = ? WHERE id = ?').run(now, existingAdmin.id);
    ensureSystemProfile(db, now);
    return null;
  }

  const id = randomBytes(16).toString('hex');
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);

  db.prepare(`
    INSERT INTO profiles (
      id,
      name,
      display_name,
      token_hash,
      status,
      is_admin,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, 'offline', 1, ?, ?)
  `).run(id, 'kisara', 'kisara', tokenHash, now, now);

  ensureSystemProfile(db, now);

  return token;
}

function ensureSystemProfile(db: Database.Database, now: string): void {
  // Create a system profile so admin-created rooms can reference it via FK
  const systemExists = db.prepare('SELECT id FROM profiles WHERE id = ?').get('system');
  if (!systemExists) {
    db.prepare(
      'INSERT INTO profiles (id, name, display_name, token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('system', 'system', 'System', 'no-login', now, now);
  }
}
