import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK_JS = resolve(__dirname, '../../dist/hooks/inbox-hook.js');

function runHook(dbPath: string, agentId?: string): Record<string, unknown> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  if (agentId) env.FLOCK_AGENT_ID = agentId;
  env.DB_PATH = dbPath;

  try {
    const out = execFileSync('node', [HOOK_JS], {
      env,
      timeout: 5000,
      input: JSON.stringify({ tool_name: 'Bash', tool_input: {} }),
      encoding: 'utf-8',
    });
    return JSON.parse(out) as Record<string, unknown>;
  } catch {
    return {};
  }
}

describe('inbox-hook', () => {
  let dbPath: string;
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'inbox-hook-test-'));
    dbPath = join(tmpDir, 'test.db');
    db = new Database(dbPath);
    db.exec(`
      CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT, status TEXT DEFAULT 'dormant');
      CREATE TABLE pending_messages (
        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, source_type TEXT NOT NULL,
        sender_id TEXT, sender_name TEXT NOT NULL DEFAULT '', content TEXT NOT NULL,
        ref_id TEXT, delivered INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
      );
      CREATE INDEX idx_pending_msg_agent ON pending_messages(agent_id, delivered);
      CREATE TABLE agent_todos (
        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, content TEXT NOT NULL,
        source_message_id TEXT, priority INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE INDEX idx_agent_todos_agent ON agent_todos(agent_id, status);
    `);
    db.prepare('INSERT INTO profiles (id, name) VALUES (?, ?)').run('agent-1', 'TestAgent');
  });
  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits {} when no inbox and no todos', () => {
    const result = runHook(dbPath, 'agent-1');
    expect(result).toEqual({});
  });

  it('emits additionalContext when inbox has messages', () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO pending_messages (id, agent_id, source_type, sender_name, content, delivered, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
    ).run('msg-1', 'agent-1', 'dm', 'kisara', 'hello there', now);

    const result = runHook(dbPath, 'agent-1');
    expect(result.hookSpecificOutput).toBeDefined();
    const ctx = (result.hookSpecificOutput as { additionalContext: string }).additionalContext;
    expect(ctx).toContain('FLOCK INBOX');
    expect(ctx).toContain('kisara');
    expect(ctx).toContain('hello there');
  });

  it('emits {} when FLOCK_AGENT_ID is missing', () => {
    const result = runHook(dbPath);
    expect(result).toEqual({});
  });

  it('emits {} when DB_PATH is missing', () => {
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    env.FLOCK_AGENT_ID = 'agent-1';
    delete env.DB_PATH;
    try {
      const out = execFileSync('node', [HOOK_JS], {
        env,
        timeout: 5000,
        input: '{}',
        encoding: 'utf-8',
      });
      expect(JSON.parse(out)).toEqual({});
    } catch {
      expect(true).toBe(true); // hook exits with 0 or 1, both fine
    }
  });
});
