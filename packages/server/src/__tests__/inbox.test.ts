import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { enqueuePendingMessage, peekPendingMessages, markDelivered, addTodo, listOpenTodos, setTodoStatus } from '../services/inbox.js';

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
      delivered INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_pending_msg_agent ON pending_messages(agent_id, delivered);
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
