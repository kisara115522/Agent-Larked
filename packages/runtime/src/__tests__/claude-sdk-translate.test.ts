/**
 * Tests for claude-sdk.ts message translation.
 *
 * Focused on the previously-dead code paths fixed in Bug #1 (user message
 * tool_result) and Bug #2 (result success + is_error:true).
 *
 * We mock @anthropic-ai/claude-agent-sdk so no real SDK calls occur.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentRunContext } from '../backends/types.js';

// ─── Mock SDK query() ─────────────────────────────────────────────────────────

const mockMessages: unknown[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: async function* (_opts: unknown) {
    for (const msg of mockMessages) {
      yield msg;
    }
  },
}));

const { ClaudeSdkBackend } = await import('../backends/claude-sdk.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function baseCtx(overrides: Partial<AgentRunContext> = {}): AgentRunContext {
  return {
    prompt: 'test',
    model: undefined,
    tools: [],
    toolExecutor: async () => ({ content: '' }),
    mcpServers: [],
    cwd: '/workspace',
    signal: new AbortController().signal,
    maxTurns: undefined,
    maxBudgetUsd: undefined,
    systemPrompt: undefined,
    ...overrides,
  };
}

async function collectEvents(
  iterable: AsyncIterable<unknown>,
): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const ev of iterable) {
    events.push(ev);
  }
  return events;
}

beforeEach(() => {
  mockMessages.length = 0;
});

// ─── C54e: Bug #2 — result success + is_error:true → error_during_execution ──

describe('claude-sdk result subtype with is_error (Bug #2)', () => {
  it('maps subtype:success + is_error:true to error_during_execution', async () => {
    mockMessages.push(
      {
        type: 'system',
        subtype: 'init',
        session_id: 'sid-e1',
        model: 'claude-opus',
        tools: [],
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: true,
        duration_ms: 50,
        session_id: 'sid-e1',
      },
    );

    const backend = new ClaudeSdkBackend();
    const events = await collectEvents(backend.run(baseCtx()));

    const resultEv = events.find(
      (e) => (e as { type: string }).type === 'result',
    ) as { type: string; subtype: string } | undefined;

    expect(resultEv).toBeDefined();
    expect(resultEv?.subtype).toBe('error_during_execution');
  });

  it('maps subtype:success + is_error:false to completed', async () => {
    mockMessages.push(
      {
        type: 'system',
        subtype: 'init',
        session_id: 'sid-e2',
        model: 'claude-opus',
        tools: [],
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 50,
        session_id: 'sid-e2',
      },
    );

    const backend = new ClaudeSdkBackend();
    const events = await collectEvents(backend.run(baseCtx()));

    const resultEv = events.find(
      (e) => (e as { type: string }).type === 'result',
    ) as { type: string; subtype: string } | undefined;

    expect(resultEv?.subtype).toBe('completed');
  });
});

// ─── C54c: Bug #1 — user message tool_result translation ─────────────────────

describe('claude-sdk user message tool_result translation (Bug #1)', () => {
  it('emits tool_result event from user message content block', async () => {
    mockMessages.push(
      {
        type: 'system',
        subtype: 'init',
        session_id: 'sid-1',
        model: 'claude-opus',
        tools: [],
        mcp_servers: [],
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-abc',
              content: 'result text',
              is_error: false,
            },
          ],
        },
        session_id: 'sid-1',
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 100,
        session_id: 'sid-1',
        total_cost_usd: 0.001,
        num_turns: 1,
      },
    );

    const backend = new ClaudeSdkBackend();
    const events = await collectEvents(backend.run(baseCtx()));

    const toolResultEvents = events.filter(
      (e) => (e as { type: string }).type === 'tool_result',
    ) as Array<{ type: string; toolUseId: string; content: string }>;

    expect(toolResultEvents).toHaveLength(1);
    expect(toolResultEvents[0].toolUseId).toBe('tool-abc');
    expect(toolResultEvents[0].content).toBe('result text');
  });

  it('emits tool_result with isError:true when block has is_error:true', async () => {
    mockMessages.push(
      {
        type: 'system',
        subtype: 'init',
        session_id: 'sid-2',
        model: 'claude-opus',
        tools: [],
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-err',
              content: 'something failed',
              is_error: true,
            },
          ],
        },
        session_id: 'sid-2',
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 50,
        session_id: 'sid-2',
      },
    );

    const backend = new ClaudeSdkBackend();
    const events = await collectEvents(backend.run(baseCtx()));

    const tr = events.find(
      (e) => (e as { type: string }).type === 'tool_result',
    ) as { type: string; toolUseId: string; isError: boolean } | undefined;

    expect(tr).toBeDefined();
    expect(tr?.toolUseId).toBe('tool-err');
    expect(tr?.isError).toBe(true);
  });
});
