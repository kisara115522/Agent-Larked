import { describe, it, expect } from 'vitest';
import {
  buildUserInput,
  buildControlAllow,
  mapResultSubtype,
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

// ─── buildControlAllow ────────────────────────────────────────────────────────

describe('buildControlAllow', () => {
  it('ends with a newline', () => {
    expect(buildControlAllow('req-1', {})).toMatch(/\n$/);
  });

  it('produces behavior:allow with correct request_id', () => {
    const raw = buildControlAllow('req-abc', { path: '/tmp' });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.type).toBe('control_response');
    const response = parsed.response as Record<string, unknown>;
    expect(response.request_id).toBe('req-abc');
    const inner = response.response as Record<string, unknown>;
    expect(inner.behavior).toBe('allow');
    expect(inner.updatedInput).toEqual({ path: '/tmp' });
  });

  it('coerces non-object input to {}', () => {
    const raw = buildControlAllow('req-x', 'not-an-object');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const inner = (parsed.response as Record<string, unknown>).response as Record<string, unknown>;
    expect(inner.updatedInput).toEqual({});
  });

  it('coerces null input to {}', () => {
    const raw = buildControlAllow('req-null', null);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const inner = (parsed.response as Record<string, unknown>).response as Record<string, unknown>;
    expect(inner.updatedInput).toEqual({});
  });
});

// ─── mapResultSubtype ─────────────────────────────────────────────────────────

describe('mapResultSubtype', () => {
  it('success + is_error:false → completed', () => {
    const msg: StreamJsonMessage = { type: 'result', subtype: 'success', is_error: false };
    expect(mapResultSubtype(msg)).toBe('completed');
  });

  it('success + is_error:true → error_during_execution (regression for API 400)', () => {
    // This is the critical bug: subtype:"success" co-occurring with is_error:true
    // happens on API 400. Must return error, not completed.
    const msg: StreamJsonMessage = { type: 'result', subtype: 'success', is_error: true };
    expect(mapResultSubtype(msg)).toBe('error_during_execution');
  });

  it('error_max_turns + is_error:false → error_max_turns', () => {
    const msg: StreamJsonMessage = { type: 'result', subtype: 'error_max_turns', is_error: false };
    expect(mapResultSubtype(msg)).toBe('error_max_turns');
  });

  it('error_max_budget_usd + is_error:false → error_max_budget_usd', () => {
    const msg: StreamJsonMessage = { type: 'result', subtype: 'error_max_budget_usd', is_error: false };
    expect(mapResultSubtype(msg)).toBe('error_max_budget_usd');
  });

  it('unknown subtype + is_error:false → completed', () => {
    const msg: StreamJsonMessage = { type: 'result', subtype: 'something_new', is_error: false };
    expect(mapResultSubtype(msg)).toBe('completed');
  });

  it('is_error:true with no subtype → error_during_execution', () => {
    const msg: StreamJsonMessage = { type: 'result', is_error: true };
    expect(mapResultSubtype(msg)).toBe('error_during_execution');
  });
});
