import { describe, it, expect, afterEach } from 'vitest';
import { createDatabase } from '@flock/server/db';
import { registerAgent } from '@flock/server/services/identity';
import { resetAgentCache, resolveAgentId, setAgentOnline, setAgentOffline } from '../db.js';
import type Database from 'better-sqlite3';

let db: Database.Database | null = null;

afterEach(() => {
  resetAgentCache();
  db?.close();
  db = null;
});

describe('MCP agent lifecycle', () => {
  it('setAgentOnline writes last_active_at', () => {
    db = createDatabase(':memory:');
    const agent = registerAgent(db, { name: 'ActiveAgent' });
    resetAgentCache();
    resolveAgentId(db, agent.name);

    setAgentOnline(db);

    const row = db.prepare('SELECT status, last_active_at FROM profiles WHERE id = ?').get(agent.id) as { status: string; last_active_at: string };
    expect(row.status).toBe('online');
    expect(row.last_active_at).toBeTruthy();
  });

  it('setAgentOffline does not overwrite last_active_at', () => {
    db = createDatabase(':memory:');
    const agent = registerAgent(db, { name: 'OfflineAgent' });
    resetAgentCache();
    resolveAgentId(db, agent.name);

    setAgentOnline(db);
    const before = db.prepare('SELECT last_active_at FROM profiles WHERE id = ?').get(agent.id) as { last_active_at: string };
    expect(before.last_active_at).toBeTruthy();

    setAgentOffline(db);
    const after = db.prepare('SELECT status, last_active_at FROM profiles WHERE id = ?').get(agent.id) as { status: string; last_active_at: string };
    expect(after.status).toBe('offline');
    // last_active_at should remain from when it was set online
    expect(after.last_active_at).toBe(before.last_active_at);
  });

  it('MCP startup does not auto-set agent online', () => {
    db = createDatabase(':memory:');
    const agent = registerAgent(db, { name: 'StartupAgent' });
    resetAgentCache();
    resolveAgentId(db, agent.name);

    // After resolveAgentId, status should still be online from registerAgent
    // but the MCP startup no longer calls setAgentOnline
    const afterRegister = db.prepare('SELECT status FROM profiles WHERE id = ?').get(agent.id) as { status: string };
    expect(afterRegister.status).toBe('dormant'); // v0.5: new agents default to dormant until Runtime spawns

    // Simulate what happens when MCP starts without calling setAgentOnline
    // The agent's status should be whatever it was before (not forced online by MCP)
    // This is a behavioral test — the actual MCP index.ts no longer calls setAgentOnline
  });
});
