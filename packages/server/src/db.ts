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
  status TEXT DEFAULT 'dormant',
  metadata TEXT DEFAULT '{}',
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_active_at TEXT
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  rules TEXT DEFAULT '',
  rules_version INTEGER DEFAULT 0,
  rules_updated_at TEXT,
  visibility TEXT DEFAULT 'public',
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
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
  agent_low_id TEXT NOT NULL,
  agent_high_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(agent_low_id, agent_high_id),
  CHECK(agent_low_id < agent_high_id)
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES direct_chats(id) ON DELETE CASCADE,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  content TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  read_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL,
  created_order INTEGER NOT NULL,
  UNIQUE(chat_id, sequence),
  UNIQUE(created_order)
);

CREATE TABLE IF NOT EXISTS direct_idempotency_keys (
  agent_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
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
  parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'todo',  -- todo/in_progress/review/done/rejected/error
  assigned_to TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  required_capabilities TEXT DEFAULT '[]',  -- JSON array
  priority INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  orchestrator_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL DEFAULT '[deleted]' REFERENCES profiles(id) ON DELETE SET DEFAULT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_room ON tasks(room_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,  -- created/assigned/started/progress/review/approved/rejected/failed/retry/completed
  actor_id TEXT NOT NULL,
  payload TEXT,  -- JSON
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id);

CREATE TABLE IF NOT EXISTS task_artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  content_type TEXT DEFAULT 'text/plain',
  size INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_artifacts_task ON task_artifacts(task_id);

-- v0.5: Human identity (separate from agent profiles)
CREATE TABLE IF NOT EXISTS humans (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- v0.5: Human login sessions
CREATE TABLE IF NOT EXISTS human_sessions (
  id TEXT PRIMARY KEY,
  human_id TEXT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_human_sessions_token ON human_sessions(token);
CREATE INDEX IF NOT EXISTS idx_human_sessions_expiry ON human_sessions(expires_at);

-- v0.5: Agent Runtime registration
CREATE TABLE IF NOT EXISTS agent_runtimes (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  callback_url TEXT NOT NULL,
  callback_secret_hash TEXT NOT NULL,
  capabilities TEXT DEFAULT '[]',
  max_agents INTEGER DEFAULT 10,
  status TEXT DEFAULT 'online',
  last_heartbeat_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- v0.5: Agent spawn records
CREATE TABLE IF NOT EXISTS agent_spawns (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  runtime_id TEXT REFERENCES agent_runtimes(id),
  session_id TEXT,
  session_source TEXT,
  agent_token_hash TEXT,
  status TEXT DEFAULT 'active',
  spawned_at TEXT DEFAULT (datetime('now')),
  last_active_at TEXT,
  prompt TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_spawns_agent ON agent_spawns(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_spawns_status ON agent_spawns(status);

-- v0.5: Token usage tracking
CREATE TABLE IF NOT EXISTS token_usage (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  task_id TEXT,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_token_usage_agent ON token_usage(agent_id);

-- v0.5: Token budgets
CREATE TABLE IF NOT EXISTS token_budgets (
  agent_id TEXT PRIMARY KEY,
  daily_limit INTEGER DEFAULT 100000,
  monthly_limit INTEGER DEFAULT 3000000,
  current_daily INTEGER DEFAULT 0,
  current_monthly INTEGER DEFAULT 0,
  last_reset_at TEXT
);

-- v0.5: Agent configuration
CREATE TABLE IF NOT EXISTS agent_configs (
  agent_id TEXT NOT NULL REFERENCES profiles(id),
  config_type TEXT NOT NULL,
  config_value TEXT NOT NULL,
  is_global INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, config_type)
);

-- v0.5: Global configuration
CREATE TABLE IF NOT EXISTS global_configs (
  config_type TEXT NOT NULL,
  config_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (config_type)
);

-- v0.5: Wake event history
CREATE TABLE IF NOT EXISTS wake_events (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  triggered_by TEXT NOT NULL,  -- agent_id or 'system'
  trigger_type TEXT NOT NULL,  -- 'mention' | 'manual' | 'broadcast' | 'spawn'
  status TEXT NOT NULL DEFAULT 'queued',  -- 'queued' | 'sent' | 'skipped' | 'failed'
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  prompt TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wake_events_agent ON wake_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_wake_events_created ON wake_events(created_at);

-- v0.5: Agent activity logs (workflow timeline)
CREATE TABLE IF NOT EXISTS agent_activity_logs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,  -- 'tool_call' | 'thinking' | 'message' | 'system' | 'error' | 'status_change'
  detail TEXT DEFAULT '',       -- human-readable description
  metadata TEXT DEFAULT '{}',   -- JSON: tool name, file path, token usage, etc.
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_agent ON agent_activity_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON agent_activity_logs(created_at);

CREATE TABLE IF NOT EXISTS agent_room_state (
  agent_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  last_seen_sequence INTEGER DEFAULT 0,
  last_processed_sequence INTEGER DEFAULT 0,
  pending_since_sequence INTEGER,
  rules_version_seen INTEGER DEFAULT 0,
  status TEXT DEFAULT 'idle',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, room_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_room_state_room ON agent_room_state(room_id);

`;

/**
 * Remove FK constraints that reference profiles(id) on tables that humans also use.
 * rooms.created_by, room_members.agent_id, direct_chats.agent_low/high_id,
 * direct_messages.from_agent/to_agent — all need to accept human IDs too.
 */
function migrateRemoveHumanFkConstraints(db: Database.Database): void {
  // Check if rooms.created_by still has a FK to profiles
  const roomFks = db.prepare('PRAGMA foreign_key_list(rooms)').all() as Array<{ from: string; table: string }>;
  const createdByFk = roomFks.find((fk) => fk.from === 'created_by' && fk.table === 'profiles');
  if (!createdByFk) return; // Already migrated

  const foreignKeysEnabled = Number(db.pragma('foreign_keys', { simple: true })) === 1;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      // 1. rooms — remove FK on created_by
      db.exec('DROP TABLE IF EXISTS _rooms_new;');
      db.exec(`
        CREATE TABLE _rooms_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT DEFAULT '',
          rules TEXT DEFAULT '',
          rules_version INTEGER DEFAULT 0,
          rules_updated_at TEXT,
          visibility TEXT DEFAULT 'public',
          created_by TEXT,
          created_at TEXT NOT NULL
        );
      `);
      db.exec(`
        INSERT INTO _rooms_new (id, name, description, rules, rules_version, rules_updated_at, visibility, created_by, created_at)
        SELECT id,
               name,
               description,
               COALESCE(rules, ''),
               COALESCE(rules_version, 0),
               rules_updated_at,
               COALESCE(visibility, 'public'),
               created_by,
               created_at
        FROM rooms;
      `);
      db.exec('DROP TABLE rooms;');
      db.exec('ALTER TABLE _rooms_new RENAME TO rooms;');

      // 2. room_members — remove FK on agent_id
      db.exec('DROP TABLE IF EXISTS _room_members_new;');
      db.exec(`
        CREATE TABLE _room_members_new (
          room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
          agent_id TEXT NOT NULL,
          joined_at TEXT NOT NULL,
          PRIMARY KEY (room_id, agent_id)
        );
      `);
      db.exec(`
        INSERT INTO _room_members_new (room_id, agent_id, joined_at)
        SELECT room_id, agent_id, joined_at FROM room_members;
      `);
      db.exec('DROP TABLE room_members;');
      db.exec('ALTER TABLE _room_members_new RENAME TO room_members;');

      // 3. direct_chats — remove FK on agent_low_id, agent_high_id
      db.exec('DROP TABLE IF EXISTS _direct_chats_new;');
      db.exec(`
        CREATE TABLE _direct_chats_new (
          id TEXT PRIMARY KEY,
          agent_low_id TEXT NOT NULL,
          agent_high_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(agent_low_id, agent_high_id),
          CHECK(agent_low_id < agent_high_id)
        );
      `);
      db.exec(`
        INSERT INTO _direct_chats_new (id, agent_low_id, agent_high_id, created_at, updated_at)
        SELECT id, agent_low_id, agent_high_id, created_at, updated_at FROM direct_chats;
      `);
      db.exec('DROP TABLE direct_chats;');
      db.exec('ALTER TABLE _direct_chats_new RENAME TO direct_chats;');

      // 4. direct_messages — remove FK on from_agent, to_agent
      db.exec('DROP TABLE IF EXISTS _direct_messages_new;');
      db.exec(`
        CREATE TABLE _direct_messages_new (
          id TEXT PRIMARY KEY,
          chat_id TEXT NOT NULL REFERENCES direct_chats(id) ON DELETE CASCADE,
          from_agent TEXT NOT NULL,
          to_agent TEXT NOT NULL,
          content TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          read_at TEXT DEFAULT NULL,
          created_at TEXT NOT NULL,
          created_order INTEGER NOT NULL,
          UNIQUE(chat_id, sequence)
        );
      `);
      db.exec(`
        INSERT INTO _direct_messages_new (id, chat_id, from_agent, to_agent, content, sequence, read_at, created_at, created_order)
        SELECT id, chat_id, from_agent, to_agent, content, sequence, read_at, created_at, created_order FROM direct_messages;
      `);
      db.exec('DROP TABLE direct_messages;');
      db.exec('ALTER TABLE _direct_messages_new RENAME TO direct_messages;');
    })();

    // Recreate indexes
    db.exec('CREATE INDEX IF NOT EXISTS idx_direct_messages_chat_seq ON direct_messages(chat_id, sequence);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_direct_messages_to_agent ON direct_messages(to_agent, created_order);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_direct_messages_from_agent ON direct_messages(from_agent, created_order);');
  } finally {
    if (foreignKeysEnabled) {
      db.pragma('foreign_keys = ON');
    }
  }
}

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
  migrateColumn(db, 'rooms', 'rules', "TEXT DEFAULT ''");
  migrateColumn(db, 'rooms', 'rules_version', 'INTEGER DEFAULT 0');
  migrateColumn(db, 'rooms', 'rules_updated_at', 'TEXT');
  migrateColumn(db, 'messages', 'broadcast', 'INTEGER DEFAULT 0');
  migrateColumn(db, 'profiles', 'last_active_at', 'TEXT');
  migrateColumn(db, 'direct_messages', 'read_at', 'TEXT DEFAULT NULL');
  // v0.5: sender_type for human/agent distinction
  migrateColumn(db, 'messages', 'sender_type', "TEXT NOT NULL DEFAULT 'agent'");
  // v0.5: store callback secret for HMAC signing (hash stays for runtime auth)
  migrateColumn(db, 'agent_runtimes', 'callback_secret', 'TEXT');
  // v0.5: task_events.event_type was added in Ring 5 but table existed from v0.4
  migrateColumn(db, 'task_events', 'event_type', "TEXT NOT NULL DEFAULT 'created'");
  migrateColumn(db, 'task_events', 'payload', 'TEXT');
  // v0.5: tasks table got new columns in Ring 5 that didn't exist in v0.4
  migrateColumn(db, 'tasks', 'assigned_to', 'TEXT REFERENCES profiles(id) ON DELETE SET NULL');
  migrateColumn(db, 'tasks', 'required_capabilities', "TEXT DEFAULT '[]'");
  migrateColumn(db, 'tasks', 'retry_count', 'INTEGER DEFAULT 0');
  migrateColumn(db, 'tasks', 'max_retries', 'INTEGER DEFAULT 3');
  migrateColumn(db, 'tasks', 'message_id', 'TEXT REFERENCES messages(id) ON DELETE SET NULL');
  migrateColumn(db, 'tasks', 'created_by', "TEXT NOT NULL DEFAULT '[deleted]' REFERENCES profiles(id) ON DELETE SET DEFAULT");
  migrateColumn(db, 'tasks', 'completed_at', 'TEXT');
  migrateColumn(db, 'tasks', 'orchestrator_id', 'TEXT REFERENCES profiles(id) ON DELETE SET NULL');
  migrateRoomsCreatedByAuditField(db);
  migrateMessagesFromAgentHistoryField(db);
  migrateAgentSpawnsRuntimeNullable(db);
  migrateColumn(db, 'agent_spawns', 'session_source', 'TEXT');
  migrateColumn(db, 'agent_spawns', 'agent_token_hash', 'TEXT');
  migrateRemoveHumanFkConstraints(db);
  backfillHumanProfiles(db);
  migrateColumn(db, 'wake_events', 'status', "TEXT NOT NULL DEFAULT 'queued'");

  // v0.3.5 stores admin privileges on agent profiles, so remove the legacy separate human admin model.
  db.exec(`
    DROP TABLE IF EXISTS admin_audit_log;
    DROP TABLE IF EXISTS human_users;
  `);

  // v0.5: Remove deprecated tables per proposal (but keep tasks - it's part of v0.5 schema)
  db.exec(`
    DROP TABLE IF EXISTS task_assignees;
    DROP TABLE IF EXISTS follows;
    DROP TABLE IF EXISTS room_invites;
  `);

  // Indexes may need to be recreated after SQLite table-rebuild migrations.
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_room_seq ON messages(room_id, sequence)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_reply ON messages(reply_to)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_broadcast ON messages(broadcast, created_order)');

  return db;
}

function backfillHumanProfiles(db: Database.Database): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO profiles (id, name, display_name, bio, capabilities, token_hash, status, created_at, updated_at)
    SELECT h.id,
           'human-' || h.id,
           COALESCE(NULLIF(h.display_name, ''), h.username),
           '',
           '[]',
           'human-no-login',
           'active',
           h.created_at,
           ?
    FROM humans h
    LEFT JOIN profiles p ON p.id = h.id
    WHERE p.id IS NULL
  `).run(now);
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

/** Bootstrap default agent 'kisara'. Returns the agent token if newly created. */
export function bootstrapDefaultAgent(db: Database.Database, hashToken: (token: string) => string): string | null {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM profiles WHERE name = ?').get('kisara') as { id: string } | undefined;

  if (existing) {
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
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, 'dormant', ?, ?)
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
          rules TEXT DEFAULT '',
          rules_version INTEGER DEFAULT 0,
          rules_updated_at TEXT,
          visibility TEXT DEFAULT 'public',
          created_by TEXT,
          created_at TEXT NOT NULL
        );
      `);
      db.exec(`
        INSERT INTO rooms_new (id, name, description, rules, rules_version, rules_updated_at, visibility, created_by, created_at)
        SELECT r.id,
               r.name,
               r.description,
               COALESCE(r.rules, ''),
               COALESCE(r.rules_version, 0),
               r.rules_updated_at,
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

function migrateAgentSpawnsRuntimeNullable(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(agent_spawns)').all() as Array<{ name: string; notnull: number }>;
  const runtimeCol = columns.find((c) => c.name === 'runtime_id');
  if (!runtimeCol || runtimeCol.notnull === 0) {
    return; // Already nullable or table doesn't exist
  }

  const foreignKeysEnabled = Number(db.pragma('foreign_keys', { simple: true })) === 1;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec('DROP TABLE IF EXISTS agent_spawns_new;');
      db.exec(`
        CREATE TABLE agent_spawns_new (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          runtime_id TEXT REFERENCES agent_runtimes(id),
          session_id TEXT,
          session_source TEXT,
          agent_token_hash TEXT,
          status TEXT DEFAULT 'active',
          spawned_at TEXT DEFAULT (datetime('now')),
          last_active_at TEXT,
          prompt TEXT
        );
      `);
      db.exec(`
        INSERT INTO agent_spawns_new (id, agent_id, runtime_id, session_id, session_source, agent_token_hash, status, spawned_at, last_active_at, prompt)
        SELECT id, agent_id, runtime_id, session_id, NULL, NULL, status, spawned_at, last_active_at, prompt
        FROM agent_spawns;
      `);
      db.exec('DROP TABLE agent_spawns;');
      db.exec('ALTER TABLE agent_spawns_new RENAME TO agent_spawns;');
    })();

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length > 0) {
      throw new Error(`agent_spawns.runtime_id migration left foreign key violations: ${JSON.stringify(violations)}`);
    }
  } finally {
    if (foreignKeysEnabled) {
      db.pragma('foreign_keys = ON');
    }
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_agent_spawns_agent ON agent_spawns(agent_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_agent_spawns_status ON agent_spawns(status);');
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
