import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createDatabase } from '@flock/server/db';
import { resolveAgentId, getAgentId, getAgentName, resetAgentCache } from '../db.js';
import { mkdtempSync, rmSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Database from 'better-sqlite3';

let db: Database.Database;
let tempDir: string;
let origFlockHome: string | undefined;

beforeAll(() => {
  db = createDatabase(':memory:');
  tempDir = mkdtempSync(join(tmpdir(), 'flock-test-'));
  origFlockHome = process.env.FLOCK_HOME;
  process.env.FLOCK_HOME = tempDir;
});

afterAll(() => {
  db.close();
  if (origFlockHome !== undefined) {
    process.env.FLOCK_HOME = origFlockHome;
  } else {
    delete process.env.FLOCK_HOME;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetAgentCache();
  delete process.env.AGENT_ID;
  delete process.env.AGENT_NAME;
  // Clean up identity file between tests
  const identityPath = join(tempDir, 'identity.json');
  if (existsSync(identityPath)) {
    unlinkSync(identityPath);
  }
});

describe('resolveAgentId', () => {
  it('auto-registers a new agent with provided name', () => {
    const result = resolveAgentId(db, 'TestAutoBot');
    expect(result.id).toBeDefined();
    expect(result.name).toBe('TestAutoBot');
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);
  });

  it('finds existing agent by name (idempotent)', () => {
    // First call registers
    const first = resolveAgentId(db, 'IdempotentBot');
    // Reset cache, call again with same name
    resetAgentCache();
    delete process.env.AGENT_ID;
    const second = resolveAgentId(db, 'IdempotentBot');
    expect(second.id).toBe(first.id);
    expect(second.name).toBe(first.name);
  });

  it('returns cached result on subsequent calls without reset', () => {
    const first = resolveAgentId(db, 'CacheTestBot');
    const second = resolveAgentId(db, 'CacheTestBot');
    expect(second.id).toBe(first.id);
    expect(second.name).toBe(first.name);
  });

  it('sets AGENT_ID env var', () => {
    resolveAgentId(db, 'EnvTestBot');
    expect(process.env.AGENT_ID).toBeDefined();
    expect(typeof process.env.AGENT_ID).toBe('string');
  });

  it('uses AGENT_NAME env var when name not provided', () => {
    process.env.AGENT_NAME = 'EnvNameAgent';
    const result = resolveAgentId(db);
    expect(result.name).toBe('EnvNameAgent');
  });

  it('generates name when no name provided and AGENT_NAME not set', () => {
    const result = resolveAgentId(db);
    expect(result.name).toMatch(/^agent-/);
  });
});

describe('getAgentId / getAgentName', () => {
  it('returns null before resolution', () => {
    resetAgentCache();
    expect(getAgentId()).toBeNull();
    expect(getAgentName()).toBeNull();
  });

  it('returns cached values after resolution', () => {
    const result = resolveAgentId(db, 'GetterTestBot');
    expect(getAgentId()).toBe(result.id);
    expect(getAgentName()).toBe(result.name);
  });
});

describe('identity file persistence', () => {
  it('writes identity.json on auto-register', () => {
    resetAgentCache();
    delete process.env.AGENT_ID;
    const result = resolveAgentId(db, 'PersistBot');
    const identityPath = join(tempDir, 'identity.json');
    const content = JSON.parse(readFileSync(identityPath, 'utf-8'));
    expect(content.id).toBe(result.id);
    expect(content.name).toBe('PersistBot');
    expect(content.token).toBeDefined();
  });

  it('reads identity.json on subsequent startup (cache reset)', () => {
    // First call writes the file
    const first = resolveAgentId(db, 'ResumeBot');
    // Simulate new process: reset cache
    resetAgentCache();
    delete process.env.AGENT_ID;
    // Second call should read from identity file
    const second = resolveAgentId(db, 'ResumeBot');
    expect(second.id).toBe(first.id);
    expect(second.name).toBe(first.name);
  });

  it('identity file takes priority over name lookup', () => {
    // Register agent A — writes identity file
    const agentA = resolveAgentId(db, 'PriorityA');
    // Reset cache, try to resolve with different name
    resetAgentCache();
    delete process.env.AGENT_ID;
    // Should return A from identity file, ignoring the new name
    const agentB = resolveAgentId(db, 'PriorityB');
    expect(agentB.id).toBe(agentA.id);
    expect(agentB.name).toBe(agentA.name);
  });

  it('re-registers when identity file points to deleted agent', () => {
    // Register and get identity
    const first = resolveAgentId(db, 'DeletedBot');
    // Manually delete the agent from DB
    db.prepare('DELETE FROM profiles WHERE id = ?').run(first.id);
    // Reset cache
    resetAgentCache();
    delete process.env.AGENT_ID;
    // Should re-register with a new ID
    const second = resolveAgentId(db, 'DeletedBot');
    expect(second.id).not.toBe(first.id);
    expect(second.name).toBe('DeletedBot');
    // Identity file should be updated
    const identityPath = join(tempDir, 'identity.json');
    const content = JSON.parse(readFileSync(identityPath, 'utf-8'));
    expect(content.id).toBe(second.id);
  });
});
