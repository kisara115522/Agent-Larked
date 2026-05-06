import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createDatabase } from '@flock/server/db';
import { resolveAgentId, getAgentId, getAgentName, resetAgentCache } from '../db.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeAll(() => {
  db = createDatabase(':memory:');
});

afterAll(() => {
  db.close();
});

beforeEach(() => {
  resetAgentCache();
  delete process.env.AGENT_ID;
  delete process.env.AGENT_NAME;
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
