import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { enqueuePendingMessage, peekPendingMessages, markDelivered, addTodo, listOpenTodos, setTodoStatus, enqueueRoomMessageForBusyAgents } from '../services/inbox.js';
import { buildInboxDigest } from '../services/inbox-digest.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT, status TEXT DEFAULT 'dormant');
    CREATE TABLE pending_messages (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      sender_id TEXT,
      sender_name TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      ref_id TEXT,
      room_id TEXT,
      delivered INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_pending_msg_agent ON pending_messages(agent_id, delivered);
    CREATE TABLE room_members (
      room_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (room_id, agent_id)
    );
    CREATE TABLE agent_todos (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      source_message_id TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX idx_agent_todos_agent ON agent_todos(agent_id, status);
    CREATE TABLE rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
  `);
  db.prepare('INSERT INTO profiles (id, name) VALUES (?, ?)').run('agent-1', 'TestAgent');
  db.prepare('INSERT INTO profiles (id, name) VALUES (?, ?)').run('agent-2', 'OtherAgent');
  return db;
}

describe('pending_messages inbox', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('enqueue + peek returns undelivered messages', () => {
    enqueuePendingMessage(db, { agentId: 'agent-1', sourceType: 'dm', senderName: 'kisara', content: 'hello' });
    enqueuePendingMessage(db, { agentId: 'agent-1', sourceType: 'mention', senderName: 'bot', content: '@you check this' });

    const msgs = peekPendingMessages(db, 'agent-1');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe('hello');
    expect(msgs[0].delivered).toBe(0);
  });

  it('peek does not return delivered messages', () => {
    const msg = enqueuePendingMessage(db, { agentId: 'agent-1', sourceType: 'dm', content: 'test' });
    markDelivered(db, [msg.id]);

    expect(peekPendingMessages(db, 'agent-1')).toHaveLength(0);
  });

  it('peek returns messages for the correct agent only', () => {
    enqueuePendingMessage(db, { agentId: 'agent-1', sourceType: 'dm', content: 'for agent 1' });
    enqueuePendingMessage(db, { agentId: 'agent-2', sourceType: 'dm', content: 'for agent 2' });

    expect(peekPendingMessages(db, 'agent-1')).toHaveLength(1);
    expect(peekPendingMessages(db, 'agent-2')).toHaveLength(1);
  });

  it('markDelivered with empty array is a no-op', () => {
    enqueuePendingMessage(db, { agentId: 'agent-1', sourceType: 'dm', content: 'test' });
    markDelivered(db, []);
    expect(peekPendingMessages(db, 'agent-1')).toHaveLength(1);
  });
});

describe('agent_todos', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('add + list returns open todos ordered by priority', () => {
    addTodo(db, { agentId: 'agent-1', content: 'low priority', priority: 0 });
    addTodo(db, { agentId: 'agent-1', content: 'high priority', priority: 10 });
    addTodo(db, { agentId: 'agent-1', content: 'medium priority', priority: 5 });

    const todos = listOpenTodos(db, 'agent-1');
    expect(todos).toHaveLength(3);
    expect(todos[0].content).toBe('high priority');
    expect(todos[1].content).toBe('medium priority');
    expect(todos[2].content).toBe('low priority');
  });

  it('complete removes todo from open list', () => {
    const todo = addTodo(db, { agentId: 'agent-1', content: 'do this' });
    expect(listOpenTodos(db, 'agent-1')).toHaveLength(1);

    const ok = setTodoStatus(db, 'agent-1', todo.id, 'done');
    expect(ok).toBe(true);
    expect(listOpenTodos(db, 'agent-1')).toHaveLength(0);
  });

  it('setTodoStatus returns false for already-completed todo', () => {
    const todo = addTodo(db, { agentId: 'agent-1', content: 'done item' });
    setTodoStatus(db, 'agent-1', todo.id, 'done');
    expect(setTodoStatus(db, 'agent-1', todo.id, 'done')).toBe(false);
  });

  it('dropped todo does not appear in open list', () => {
    const todo = addTodo(db, { agentId: 'agent-1', content: 'dropped item' });
    setTodoStatus(db, 'agent-1', todo.id, 'dropped');
    expect(listOpenTodos(db, 'agent-1')).toHaveLength(0);
  });

  it('todos are agent-scoped', () => {
    addTodo(db, { agentId: 'agent-1', content: 'for agent 1' });
    addTodo(db, { agentId: 'agent-2', content: 'for agent 2' });
    expect(listOpenTodos(db, 'agent-1')).toHaveLength(1);
    expect(listOpenTodos(db, 'agent-2')).toHaveLength(1);
  });
});

describe('buildInboxDigest', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns null when inbox and todos are empty', () => {
    expect(buildInboxDigest(db, 'agent-1')).toBeNull();
  });

  it('includes pending messages and marks them delivered', () => {
    enqueuePendingMessage(db, { agentId: 'agent-1', sourceType: 'dm', senderName: 'kisara', content: 'hello there' });

    const digest = buildInboxDigest(db, 'agent-1')!;
    expect(digest).not.toBeNull();
    expect(digest.new_messages).toHaveLength(1);
    expect(digest.new_messages[0].from).toBe('kisara');
    expect(digest.new_messages[0].content).toBe('hello there');
    expect(digest.new_messages[0].source).toBe('dm');

    // Second call should return null — messages already delivered
    expect(buildInboxDigest(db, 'agent-1')).toBeNull();
  });

  it('includes open todos (persist across calls)', () => {
    addTodo(db, { agentId: 'agent-1', content: 'review PR', priority: 5 });

    const d1 = buildInboxDigest(db, 'agent-1')!;
    expect(d1.open_todos).toHaveLength(1);
    expect(d1.open_todos[0].content).toBe('review PR');

    // Todos persist — still there on next call
    const d2 = buildInboxDigest(db, 'agent-1')!;
    expect(d2.open_todos).toHaveLength(1);
  });

  it('includes guidance text mentioning both messages and todos', () => {
    enqueuePendingMessage(db, { agentId: 'agent-1', sourceType: 'dm', content: 'ping' });
    addTodo(db, { agentId: 'agent-1', content: 'do stuff' });

    const digest = buildInboxDigest(db, 'agent-1')!;
    expect(digest.guidance).toContain('1 new message');
    expect(digest.guidance).toContain('1 open todo');
  });

  it('includes room_id and flock_room_sync hint for room-source messages', () => {
    enqueuePendingMessage(db, {
      agentId: 'agent-1',
      sourceType: 'room',
      senderName: 'kisara',
      content: 'hey room',
      roomId: 'room-42',
    });

    const digest = buildInboxDigest(db, 'agent-1')!;
    expect(digest.new_messages[0].source).toBe('room');
    expect(digest.new_messages[0].room_id).toBe('room-42');
    expect(digest.guidance).toContain('flock_room_sync');
  });

  it('renders room name in from and exposes message_id + dedup hint for room messages', () => {
    db.prepare('INSERT INTO rooms (id, name, created_at) VALUES (?, ?, ?)').run('room-42', 'design', new Date().toISOString());
    enqueuePendingMessage(db, {
      agentId: 'agent-1',
      sourceType: 'room',
      senderName: 'kisara',
      content: 'hey room',
      roomId: 'room-42',
      refId: 'msg-abc',
    });

    const digest = buildInboxDigest(db, 'agent-1')!;
    // from carries "<sender> in #<roomName>"
    expect(digest.new_messages[0].from).toBe('kisara in #design');
    // message_id is exposed (sourced from ref_id) for dedup
    expect(digest.new_messages[0].message_id).toBe('msg-abc');
    // dedup hint in guidance references flock_wait + message_id
    expect(digest.guidance).toContain('message_id');
    expect(digest.guidance).toContain('flock_wait');
  });

  it('falls back to room_id in from when the room name is missing', () => {
    enqueuePendingMessage(db, {
      agentId: 'agent-1',
      sourceType: 'room',
      senderName: 'kisara',
      content: 'orphan room msg',
      roomId: 'room-gone',
      refId: 'msg-xyz',
    });

    const digest = buildInboxDigest(db, 'agent-1')!;
    expect(digest.new_messages[0].from).toBe('kisara in #room-gone');
  });

  it('does not add message_id for non-room (dm) messages', () => {
    enqueuePendingMessage(db, {
      agentId: 'agent-1',
      sourceType: 'dm',
      senderName: 'kisara',
      content: 'a dm',
      refId: 'dm-1',
    });

    const digest = buildInboxDigest(db, 'agent-1')!;
    expect(digest.new_messages[0].from).toBe('kisara');
    expect(digest.new_messages[0].message_id).toBeUndefined();
  });
});

describe('busy agent inbox integration', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('enqueuePendingMessage works for active agent', () => {
    db.prepare('UPDATE profiles SET status = ? WHERE id = ?').run('active', 'agent-1');

    enqueuePendingMessage(db, {
      agentId: 'agent-1',
      sourceType: 'dm',
      senderId: 'human-1',
      senderName: 'kisara',
      content: 'hey, check this out',
    });

    const msgs = peekPendingMessages(db, 'agent-1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('hey, check this out');
    expect(msgs[0].source_type).toBe('dm');
  });
});

describe('enqueueRoomMessageForBusyAgents', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    // agent-1 dormant, agent-2 active, add agent-3 spawning
    db.prepare('INSERT INTO profiles (id, name, status) VALUES (?, ?, ?)').run('agent-3', 'Spawn', 'spawning');
    db.prepare('UPDATE profiles SET status = ? WHERE id = ?').run('active', 'agent-2');
    // room-1 has all three agents as members
    const now = new Date().toISOString();
    db.prepare('INSERT INTO room_members (room_id, agent_id, joined_at) VALUES (?, ?, ?)').run('room-1', 'agent-1', now);
    db.prepare('INSERT INTO room_members (room_id, agent_id, joined_at) VALUES (?, ?, ?)').run('room-1', 'agent-2', now);
    db.prepare('INSERT INTO room_members (room_id, agent_id, joined_at) VALUES (?, ?, ?)').run('room-1', 'agent-3', now);
  });
  afterEach(() => { db.close(); });

  it('enqueues only for active/spawning members, not dormant or sender', () => {
    enqueueRoomMessageForBusyAgents(db, {
      roomId: 'room-1',
      senderId: 'agent-1',
      senderName: 'TestAgent',
      excerpt: 'hello room',
      messageId: 'msg-1',
    });

    // agent-2 (active) and agent-3 (spawning) should have inbox entries
    expect(peekPendingMessages(db, 'agent-2')).toHaveLength(1);
    expect(peekPendingMessages(db, 'agent-3')).toHaveLength(1);
    // agent-1 is dormant AND the sender — no entry
    expect(peekPendingMessages(db, 'agent-1')).toHaveLength(0);
  });

  it('sets source_type=room and room_id on enqueued messages', () => {
    enqueueRoomMessageForBusyAgents(db, {
      roomId: 'room-1',
      senderId: 'agent-1',
      senderName: 'TestAgent',
      excerpt: 'room msg',
    });

    const msgs = peekPendingMessages(db, 'agent-2');
    expect(msgs[0].source_type).toBe('room');
    expect(msgs[0].room_id).toBe('room-1');
    expect(msgs[0].content).toBe('room msg');
    expect(msgs[0].sender_name).toBe('TestAgent');
  });

  it('excludes the sender even if sender is active', () => {
    db.prepare('UPDATE profiles SET status = ? WHERE id = ?').run('active', 'agent-1');

    enqueueRoomMessageForBusyAgents(db, {
      roomId: 'room-1',
      senderId: 'agent-1',
      senderName: 'TestAgent',
      excerpt: 'self msg',
    });

    // agent-1 is sender — excluded; agent-2 and agent-3 still get it
    expect(peekPendingMessages(db, 'agent-1')).toHaveLength(0);
    expect(peekPendingMessages(db, 'agent-2')).toHaveLength(1);
  });

  it('@mention (onlyAgentIds) injects only the mentioned busy member, not other busy members', () => {
    // agent-2 (active) and agent-3 (spawning) are both busy; @mention only agent-2
    enqueueRoomMessageForBusyAgents(db, {
      roomId: 'room-1',
      senderId: 'agent-1',
      senderName: 'TestAgent',
      excerpt: '@agent-2 ping',
      messageId: 'msg-mention',
      onlyAgentIds: ['agent-2'],
    });

    expect(peekPendingMessages(db, 'agent-2')).toHaveLength(1);
    // agent-3 is busy but not mentioned — must NOT be injected
    expect(peekPendingMessages(db, 'agent-3')).toHaveLength(0);
  });

  it('broadcast (no onlyAgentIds) injects all busy members', () => {
    enqueueRoomMessageForBusyAgents(db, {
      roomId: 'room-1',
      senderId: 'agent-1',
      senderName: 'TestAgent',
      excerpt: 'hello everyone',
      messageId: 'msg-broadcast',
    });

    // Both busy members get it; the dormant sender does not.
    expect(peekPendingMessages(db, 'agent-2')).toHaveLength(1);
    expect(peekPendingMessages(db, 'agent-3')).toHaveLength(1);
  });

  it('empty onlyAgentIds is treated as broadcast (injects all busy members)', () => {
    enqueueRoomMessageForBusyAgents(db, {
      roomId: 'room-1',
      senderId: 'agent-1',
      senderName: 'TestAgent',
      excerpt: 'still a broadcast',
      onlyAgentIds: [],
    });

    expect(peekPendingMessages(db, 'agent-2')).toHaveLength(1);
    expect(peekPendingMessages(db, 'agent-3')).toHaveLength(1);
  });

  it('@mention of a dormant agent injects nobody (mentioned agent is not busy)', () => {
    // agent-1 is dormant (and is the sender here we use agent-2 as sender so
    // agent-1 is a candidate); mention agent-1 who is dormant -> no busy match.
    db.prepare('UPDATE profiles SET status = ? WHERE id = ?').run('active', 'agent-2');
    enqueueRoomMessageForBusyAgents(db, {
      roomId: 'room-1',
      senderId: 'agent-2',
      senderName: 'OtherAgent',
      excerpt: '@agent-1 hi',
      onlyAgentIds: ['agent-1'],
    });

    // agent-1 is dormant -> not in busy set -> intersection empty -> nobody injected
    expect(peekPendingMessages(db, 'agent-1')).toHaveLength(0);
    expect(peekPendingMessages(db, 'agent-3')).toHaveLength(0);
  });
});
