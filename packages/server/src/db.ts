import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DELETED_AGENT_ID, SYSTEM_AGENT_ID } from './services/reserved-profiles.js';

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
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
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
  from_agent TEXT NOT NULL DEFAULT '[deleted]' REFERENCES profiles(id) ON DELETE SET DEFAULT,
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

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  created_by TEXT NOT NULL DEFAULT '[deleted]' REFERENCES profiles(id) ON DELETE SET DEFAULT,
  origin_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  cancelled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_room_status ON tasks(room_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by, updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_origin_message ON tasks(origin_message_id);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_by TEXT NOT NULL DEFAULT '[deleted]' REFERENCES profiles(id) ON DELETE SET DEFAULT,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (task_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignees_agent ON task_assignees(agent_id, task_id);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL DEFAULT '[deleted]' REFERENCES profiles(id) ON DELETE SET DEFAULT,
  type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  body TEXT DEFAULT '',
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  created_order INTEGER NOT NULL,
  UNIQUE(created_order)
);

CREATE INDEX IF NOT EXISTS idx_task_events_task_order ON task_events(task_id, created_order);
CREATE INDEX IF NOT EXISTS idx_task_events_actor ON task_events(actor_id, created_order);

CREATE TABLE IF NOT EXISTS task_artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL DEFAULT '[deleted]' REFERENCES profiles(id) ON DELETE SET DEFAULT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT,
  uri TEXT,
  mime_type TEXT DEFAULT '',
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_artifacts_task ON task_artifacts(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_artifacts_creator ON task_artifacts(created_by, created_at);

CREATE TABLE IF NOT EXISTS task_idempotency_keys (
  agent_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, key)
);

CREATE INDEX IF NOT EXISTS idx_task_idempotency_expiry ON task_idempotency_keys(expires_at);

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
  migrateRoomsCreatedByAuditField(db);
  migrateMessagesFromAgentHistoryField(db);

  // v0.3.5 stores admin privileges on agent profiles, so remove the legacy separate human admin model.
  db.exec(`
    DROP TABLE IF EXISTS admin_audit_log;
    DROP TABLE IF EXISTS human_users;
  `);

  // Indexes may need to be recreated after SQLite table-rebuild migrations.
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_room_seq ON messages(room_id, sequence)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_reply ON messages(reply_to)');
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
  const taskResult = db.prepare("DELETE FROM task_idempotency_keys WHERE expires_at < datetime('now')").run();
  return roomResult.changes + directResult.changes + taskResult.changes;
}

/** Bootstrap default admin agent 'kisara'. Returns the agent token if newly created. */
export function bootstrapDefaultAdmin(db: Database.Database, hashToken: (token: string) => string): string | null {
  const now = new Date().toISOString();
  const existingAdmin = db.prepare('SELECT id FROM profiles WHERE name = ?').get('kisara') as { id: string } | undefined;

  if (existingAdmin) {
    db.prepare('UPDATE profiles SET is_admin = 1, updated_at = ? WHERE id = ?').run(now, existingAdmin.id);
    ensureReservedProfiles(db, now);
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

  ensureReservedProfiles(db, now);

  return token;
}

function migrateRoomsCreatedByAuditField(db: Database.Database): void {
  const foreignKeys = db.prepare('PRAGMA foreign_key_list(rooms)').all() as Array<{
    from: string;
    on_delete: string;
  }>;
  const createdByFk = foreignKeys.find((fk) => fk.from === 'created_by');
  if (!createdByFk || createdByFk.on_delete.toUpperCase() === 'SET NULL') {
    return;
  }

  const now = new Date().toISOString();
  ensureReservedProfiles(db, now);

  const foreignKeysEnabled = Number(db.pragma('foreign_keys', { simple: true })) === 1;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec('DROP TABLE IF EXISTS rooms_new;');
      db.exec(`
        CREATE TABLE rooms_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT DEFAULT '',
          visibility TEXT DEFAULT 'public',
          created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL
        );
      `);
      db.exec(`
        INSERT INTO rooms_new (id, name, description, visibility, created_by, created_at)
        SELECT r.id,
               r.name,
               r.description,
               COALESCE(r.visibility, 'public'),
               CASE WHEN p.id IS NULL THEN NULL ELSE r.created_by END,
               r.created_at
        FROM rooms r
        LEFT JOIN profiles p ON p.id = r.created_by;
      `);
      db.exec('DROP TABLE rooms;');
      db.exec('ALTER TABLE rooms_new RENAME TO rooms;');
    })();

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length > 0) {
      throw new Error(`rooms.created_by migration left foreign key violations: ${JSON.stringify(violations)}`);
    }
  } finally {
    if (foreignKeysEnabled) {
      db.pragma('foreign_keys = ON');
    }
  }
}

function migrateMessagesFromAgentHistoryField(db: Database.Database): void {
  const foreignKeys = db.prepare('PRAGMA foreign_key_list(messages)').all() as Array<{
    from: string;
    on_delete: string;
  }>;
  const fromAgentFk = foreignKeys.find((fk) => fk.from === 'from_agent');
  if (!fromAgentFk || fromAgentFk.on_delete.toUpperCase() === 'SET DEFAULT') {
    return;
  }

  const now = new Date().toISOString();
  ensureReservedProfiles(db, now);

  const foreignKeysEnabled = Number(db.pragma('foreign_keys', { simple: true })) === 1;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec('DROP TABLE IF EXISTS messages_new;');
      db.exec(`
        CREATE TABLE messages_new (
          id TEXT PRIMARY KEY,
          from_agent TEXT NOT NULL DEFAULT '${DELETED_AGENT_ID}' REFERENCES profiles(id) ON DELETE SET DEFAULT,
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
      `);
      db.exec(`
        INSERT INTO messages_new (id, from_agent, room_id, content, reply_to, broadcast, sequence, created_at, created_order)
        SELECT m.id,
               CASE WHEN p.id IS NULL THEN '${DELETED_AGENT_ID}' ELSE m.from_agent END,
               m.room_id,
               m.content,
               m.reply_to,
               COALESCE(m.broadcast, 0),
               m.sequence,
               m.created_at,
               m.created_order
        FROM messages m
        LEFT JOIN profiles p ON p.id = m.from_agent;
      `);
      db.exec('DROP TABLE messages;');
      db.exec('ALTER TABLE messages_new RENAME TO messages;');
    })();

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length > 0) {
      throw new Error(`messages.from_agent migration left foreign key violations: ${JSON.stringify(violations)}`);
    }
  } finally {
    if (foreignKeysEnabled) {
      db.pragma('foreign_keys = ON');
    }
  }
}

function ensureReservedProfiles(db: Database.Database, now: string): void {
  db.prepare(`
    INSERT OR IGNORE INTO profiles (id, name, display_name, token_hash, created_at, updated_at)
    VALUES (?, ?, ?, 'no-login', ?, ?)
  `).run(SYSTEM_AGENT_ID, 'system', 'System', now, now);

  db.prepare(`
    INSERT OR IGNORE INTO profiles (id, name, display_name, token_hash, created_at, updated_at)
    VALUES (?, ?, ?, 'no-login', ?, ?)
  `).run(DELETED_AGENT_ID, '[deleted]', 'Deleted Agent', now, now);
}
