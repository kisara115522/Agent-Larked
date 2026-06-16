import { describe, it, expect } from 'vitest';
import {
  buildUserInput,
  buildControlAllow,
  mapResultSubtype,
  translateContentBlock,
  translateStreamMessage,
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

// ─── translateContentBlock ────────────────────────────────────────────────────

describe('translateContentBlock', () => {
  it('text block → TextEvent', () => {
    const ev = translateContentBlock({ type: 'text', text: 'hello' });
    expect(ev).toEqual({ type: 'text', content: 'hello' });
  });

  it('text block with missing text → null', () => {
    expect(translateContentBlock({ type: 'text' })).toBeNull();
  });

  it('thinking block → ThinkingEvent', () => {
    const ev = translateContentBlock({ type: 'thinking', thinking: 'I think...' });
    expect(ev).toEqual({ type: 'thinking', content: 'I think...' });
  });

  it('thinking block with missing thinking → null', () => {
    expect(translateContentBlock({ type: 'thinking' })).toBeNull();
  });

  it('tool_use block → ToolUseEvent', () => {
    const ev = translateContentBlock({
      type: 'tool_use',
      id: 'tu_1',
      name: 'Read',
      input: { file_path: '/tmp/x' },
    });
    expect(ev).toEqual({
      type: 'tool_use',
      id: 'tu_1',
      name: 'Read',
      input: { file_path: '/tmp/x' },
    });
  });

  it('tool_use block missing id → null', () => {
    expect(translateContentBlock({ type: 'tool_use', name: 'Read' })).toBeNull();
  });

  it('tool_result block → ToolResultEvent', () => {
    const ev = translateContentBlock({
      type: 'tool_result',
      tool_use_id: 'tu_1',
      content: 'file data',
      is_error: false,
    });
    expect(ev).toEqual({
      type: 'tool_result',
      toolUseId: 'tu_1',
      content: 'file data',
      isError: false,
    });
  });

  it('tool_result with object content serializes to JSON string', () => {
    const ev = translateContentBlock({
      type: 'tool_result',
      tool_use_id: 'tu_2',
      content: { key: 'val' },
    });
    expect(ev?.type).toBe('tool_result');
    if (ev?.type === 'tool_result') {
      expect(ev.content).toBe(JSON.stringify({ key: 'val' }));
    }
  });

  it('tool_result missing tool_use_id → null', () => {
    expect(translateContentBlock({ type: 'tool_result', content: 'x' })).toBeNull();
  });

  it('unknown block type → null', () => {
    expect(translateContentBlock({ type: 'image_url' })).toBeNull();
  });
});

// ─── Wire fixtures (real lines from claude CLI 2.1.178) ───────────────────────

const INIT_LINE = JSON.stringify({
  type: 'system',
  subtype: 'init',
  cwd: '/workspace',
  session_id: 'cc0a8157-dead-beef-cafe-000000000001',
  tools: ['Bash', 'Read', 'Edit'],
  mcp_servers: [{ name: 'probe', status: 'pending' }],
  model: 'ppio/pa/claude-opus-4-8[1M]',
  permissionMode: 'bypassPermissions',
});

const ASSISTANT_LINE = JSON.stringify({
  type: 'assistant',
  message: {
    model: 'pa/claude-opus-4-8',
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'alpha bravo charlie' }],
    stop_reason: null,
  },
  session_id: 'cc0a8157-dead-beef-cafe-000000000001',
});

const USER_TOOL_RESULT_LINE = JSON.stringify({
  type: 'user',
  message: {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_test_123',
        content: 'file contents here',
        is_error: false,
      },
    ],
  },
  session_id: 'cc0a8157-dead-beef-cafe-000000000001',
});

const RESULT_SUCCESS_LINE = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 4256,
  num_turns: 1,
  result: 'alpha bravo charlie',
  session_id: 'cc0a8157-dead-beef-cafe-000000000001',
  total_cost_usd: 0.2246,
});

const RESULT_ERROR_LINE = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: true,
  duration_ms: 100,
  result: 'API Error: 400 Param Incorrect',
  session_id: 'cc0a8157-dead-beef-cafe-000000000001',
});

// ─── translateStreamMessage ───────────────────────────────────────────────────

describe('translateStreamMessage with real wire fixtures', () => {
  it('init line → InitEvent with sessionId/model/tools/mcpServers', () => {
    const msg = JSON.parse(INIT_LINE) as StreamJsonMessage;
    const events = translateStreamMessage(msg);
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.type).toBe('init');
    if (ev.type === 'init') {
      expect(ev.sessionId).toBe('cc0a8157-dead-beef-cafe-000000000001');
      expect(ev.model).toBe('ppio/pa/claude-opus-4-8[1M]');
      expect(ev.tools).toContain('Bash');
      expect(ev.mcpServers).toEqual([{ name: 'probe', status: 'pending' }]);
    }
  });

  it('assistant line → TextEvent with correct content', () => {
    const msg = JSON.parse(ASSISTANT_LINE) as StreamJsonMessage;
    const events = translateStreamMessage(msg);
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.type).toBe('text');
    if (ev.type === 'text') {
      expect(ev.content).toBe('alpha bravo charlie');
    }
  });

  it('user+tool_result line → ToolResultEvent', () => {
    const msg = JSON.parse(USER_TOOL_RESULT_LINE) as StreamJsonMessage;
    const events = translateStreamMessage(msg);
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.type).toBe('tool_result');
    if (ev.type === 'tool_result') {
      expect(ev.toolUseId).toBe('toolu_test_123');
      expect(ev.content).toBe('file contents here');
      expect(ev.isError).toBe(false);
    }
  });

  it('result success line → ResultEvent completed', () => {
    const msg = JSON.parse(RESULT_SUCCESS_LINE) as StreamJsonMessage;
    const events = translateStreamMessage(msg);
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.type).toBe('result');
    if (ev.type === 'result') {
      expect(ev.subtype).toBe('completed');
      expect(ev.sessionId).toBe('cc0a8157-dead-beef-cafe-000000000001');
      expect(ev.durationMs).toBe(4256);
      expect(ev.numTurns).toBe(1);
    }
  });

  it('result is_error:true line → ResultEvent error_during_execution', () => {
    const msg = JSON.parse(RESULT_ERROR_LINE) as StreamJsonMessage;
    const events = translateStreamMessage(msg);
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.type).toBe('result');
    if (ev.type === 'result') {
      expect(ev.subtype).toBe('error_during_execution');
    }
  });

  it('unknown type → empty array', () => {
    const msg: StreamJsonMessage = { type: 'some_future_type' };
    expect(translateStreamMessage(msg)).toEqual([]);
  });

  it('system/non-init subtype → empty array', () => {
    const msg: StreamJsonMessage = { type: 'system', subtype: 'something_else' };
    expect(translateStreamMessage(msg)).toEqual([]);
  });
});
