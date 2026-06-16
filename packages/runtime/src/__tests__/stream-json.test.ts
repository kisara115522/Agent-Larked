import { describe, it, expect } from 'vitest';
import {
  buildUserInput,
} from '../backends/stream-json.js';
import type { StreamJsonMessage } from '../backends/stream-json.js';

// ─── buildUserInput ───────────────────────────────────────────────────────────

describe('buildUserInput', () => {
  it('ends with a newline', () => {
    expect(buildUserInput('hi')).toMatch(/\n$/);
  });

  it('parses back to the correct structure', () => {
    const raw = buildUserInput('hello world');
    const parsed = JSON.parse(raw) as StreamJsonMessage;
    expect(parsed.type).toBe('user');
    expect(parsed.message?.role).toBe('user');
    expect(Array.isArray(parsed.message?.content)).toBe(true);
    expect(parsed.message?.content?.[0].type).toBe('text');
    expect(parsed.message?.content?.[0].text).toBe('hello world');
  });
});
