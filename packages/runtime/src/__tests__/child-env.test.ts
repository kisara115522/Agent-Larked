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
