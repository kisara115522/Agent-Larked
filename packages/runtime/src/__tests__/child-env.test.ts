import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isInternalClaudeEnvKey, buildChildEnv } from '../backends/child-env.js';

describe('isInternalClaudeEnvKey', () => {
  it('returns true for CLAUDECODE', () => {
    expect(isInternalClaudeEnvKey('CLAUDECODE')).toBe(true);
  });

  it('returns true for CLAUDE_CODE_ENTRYPOINT', () => {
    expect(isInternalClaudeEnvKey('CLAUDE_CODE_ENTRYPOINT')).toBe(true);
  });

  it('returns true for CLAUDE_CODE_EXECPATH', () => {
    expect(isInternalClaudeEnvKey('CLAUDE_CODE_EXECPATH')).toBe(true);
  });

  it('returns true for CLAUDE_CODE_SESSION_ID', () => {
    expect(isInternalClaudeEnvKey('CLAUDE_CODE_SESSION_ID')).toBe(true);
  });

  it('returns true for CLAUDE_CODE_SSE_PORT', () => {
    expect(isInternalClaudeEnvKey('CLAUDE_CODE_SSE_PORT')).toBe(true);
  });

  it('returns true for CLAUDE_EFFORT', () => {
    expect(isInternalClaudeEnvKey('CLAUDE_EFFORT')).toBe(true);
  });

  it('returns true for CLAUDECODE_SOME_INTERNAL_KEY (prefix)', () => {
    expect(isInternalClaudeEnvKey('CLAUDECODE_SOMETHING')).toBe(true);
  });

  it('returns false for CLAUDE_CODE_USE_BEDROCK (user-facing namespace)', () => {
    expect(isInternalClaudeEnvKey('CLAUDE_CODE_USE_BEDROCK')).toBe(false);
  });

  it('returns false for PATH', () => {
    expect(isInternalClaudeEnvKey('PATH')).toBe(false);
  });

  it('returns false for HOME', () => {
    expect(isInternalClaudeEnvKey('HOME')).toBe(false);
  });
});

describe('buildChildEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore process.env after each test that mutates it
    for (const k of Object.keys(process.env)) {
      if (!(k in originalEnv)) delete process.env[k];
    }
    for (const [k, v] of Object.entries(originalEnv)) {
      process.env[k] = v;
    }
  });

  it('includes PATH from process.env', () => {
    const env = buildChildEnv();
    expect(env.PATH).toBe(process.env.PATH);
  });

  it('strips CLAUDE_EFFORT when set in process.env', () => {
    process.env.CLAUDE_EFFORT = 'high';
    const env = buildChildEnv();
    expect('CLAUDE_EFFORT' in env).toBe(false);
  });

  it('strips CLAUDECODE when set in process.env', () => {
    process.env.CLAUDECODE = '1';
    const env = buildChildEnv();
    expect('CLAUDECODE' in env).toBe(false);
  });

  it('merges extra keys on top of filtered env', () => {
    const env = buildChildEnv({ FOO: 'bar' });
    expect(env.FOO).toBe('bar');
  });

  it('extra key can override a non-internal process.env key', () => {
    process.env.SOME_KEY = 'original';
    const env = buildChildEnv({ SOME_KEY: 'overridden' });
    expect(env.SOME_KEY).toBe('overridden');
  });

  it('preserves CLAUDE_CODE_USE_BEDROCK (user-facing)', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1';
    const env = buildChildEnv();
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1');
  });
});
