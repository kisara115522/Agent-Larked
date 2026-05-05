import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  bio TEXT DEFAULT '',
  capabilities TEXT DEFAULT '[]',
  model TEXT DEFAULT '',
  owner TEXT DEFAULT '',
  status TEXT DEFAULT 'offline',
  metadata TEXT DEFAULT '{}',
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
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
  return db;
}

export function cleanupIdempotencyKeys(db: Database.Database): number {
  const result = db.prepare("DELETE FROM idempotency_keys WHERE expires_at < datetime('now')").run();
  return result.changes;
}
