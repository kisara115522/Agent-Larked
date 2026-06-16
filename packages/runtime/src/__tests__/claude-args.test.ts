import { describe, it, expect } from 'vitest';
import { buildClaudeArgs } from '../backends/claude-args.js';
import type { AgentRunContext } from '../backends/types.js';

function baseCtx(overrides: Partial<AgentRunContext> = {}): AgentRunContext {
  return {
    prompt: 'do stuff',
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

describe('buildClaudeArgs', () => {
  const REQUIRED_FLAGS = [
    '-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
    '--strict-mcp-config',
    '--permission-mode', 'bypassPermissions',
    '--disallowedTools', 'AskUserQuestion',
    '--effort', 'normal',
  ];

  it('always includes all required protocol flags', () => {
    const args = buildClaudeArgs(baseCtx(), { mcpConfigPath: '/tmp/mcp.json' });
    for (let i = 0; i < REQUIRED_FLAGS.length; i++) {
      expect(args).toContain(REQUIRED_FLAGS[i]);
    }
  });

  it('includes --mcp-config with the provided path', () => {
    const args = buildClaudeArgs(baseCtx(), { mcpConfigPath: '/tmp/my-mcp.json' });
    const idx = args.indexOf('--mcp-config');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('/tmp/my-mcp.json');
  });

  it('always passes --effort normal to override settings.json effortLevel', () => {
    const args = buildClaudeArgs(baseCtx(), { mcpConfigPath: '/tmp/mcp.json' });
    const idx = args.indexOf('--effort');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('normal');
  });

  it('omits --model when ctx.model is undefined', () => {
    const args = buildClaudeArgs(baseCtx(), { mcpConfigPath: '/tmp/mcp.json' });
    expect(args).not.toContain('--model');
  });

  it('includes --model when ctx.model is set', () => {
    const args = buildClaudeArgs(
      baseCtx({ model: 'claude-opus-4-8' }),
      { mcpConfigPath: '/tmp/mcp.json' },
    );
    const idx = args.indexOf('--model');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('claude-opus-4-8');
  });

  it('includes --max-turns when ctx.maxTurns is set', () => {
    const args = buildClaudeArgs(
      baseCtx({ maxTurns: 20 }),
      { mcpConfigPath: '/tmp/mcp.json' },
    );
    const idx = args.indexOf('--max-turns');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('20');
  });

  it('omits --max-turns when ctx.maxTurns is undefined', () => {
    const args = buildClaudeArgs(baseCtx(), { mcpConfigPath: '/tmp/mcp.json' });
    expect(args).not.toContain('--max-turns');
  });

  it('includes --max-budget-usd when ctx.maxBudgetUsd is set', () => {
    const args = buildClaudeArgs(
      baseCtx({ maxBudgetUsd: 0.5 }),
      { mcpConfigPath: '/tmp/mcp.json' },
    );
    const idx = args.indexOf('--max-budget-usd');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('0.5');
  });

  it('includes --append-system-prompt when ctx.systemPrompt is set', () => {
    const args = buildClaudeArgs(
      baseCtx({ systemPrompt: 'You are helpful.' }),
      { mcpConfigPath: '/tmp/mcp.json' },
    );
    const idx = args.indexOf('--append-system-prompt');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('You are helpful.');
  });

  it('includes --resume when resumeSessionId is provided', () => {
    const args = buildClaudeArgs(
      baseCtx(),
      { mcpConfigPath: '/tmp/mcp.json', resumeSessionId: 'sess-abc' },
    );
    const idx = args.indexOf('--resume');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('sess-abc');
  });

  it('omits --resume when resumeSessionId is absent', () => {
    const args = buildClaudeArgs(baseCtx(), { mcpConfigPath: '/tmp/mcp.json' });
    expect(args).not.toContain('--resume');
  });
});
