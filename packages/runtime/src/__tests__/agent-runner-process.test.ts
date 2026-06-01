import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActivityReporter } from '../agent-runner.js';

// Mock the SDK query function
const mockQuery = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
}));

const { AgentRunner } = await import('../agent-runner.js');

/** Creates an async generator that yields the given messages then completes */
function createMockQuery(messages: unknown[], options?: { throwError?: Error }) {
  return (async function* () {
    if (options?.throwError) throw options.throwError;
    for (const msg of messages) {
      yield msg;
    }
  })();
}

const INIT_MESSAGE = {
  type: 'system' as const,
  subtype: 'init' as const,
  session_id: 'test-session-id',
  model: 'claude-sonnet-4-6',
  tools: ['Read', 'Edit', 'Bash'],
  mcp_servers: [{ name: 'flock', status: 'connected' }],
  cwd: '/test',
  apiKeySource: 'api-key' as const,
  permissionMode: 'bypassPermissions' as const,
  slash_commands: [],
  output_style: 'text',
  skills: [],
  plugins: [],
  uuid: 'init-uuid',
};

const SUCCESS_RESULT = {
  type: 'result' as const,
  subtype: 'success' as const,
  session_id: 'test-session-id',
  duration_ms: 5000,
  duration_api_ms: 3000,
  is_error: false,
  num_turns: 3,
  result: 'Done!',
  stop_reason: 'end_turn',
  total_cost_usd: 0.01,
  usage: { input_tokens: 100, output_tokens: 50 },
  modelUsage: {},
  permission_denials: [],
  uuid: 'result-uuid',
};

const ERROR_RESULT = {
  type: 'result' as const,
  subtype: 'error_during_execution' as const,
  session_id: 'test-session-id',
  duration_ms: 1000,
  duration_api_ms: 500,
  is_error: true,
  num_turns: 1,
  stop_reason: 'error',
  total_cost_usd: 0.001,
  usage: { input_tokens: 50, output_tokens: 10 },
  modelUsage: {},
  permission_denials: [],
  errors: ['API Error: 403'],
  uuid: 'error-uuid',
};

describe('AgentRunner SDK integration', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('starts a new agent via SDK query and reports active on init', async () => {
    mockQuery.mockReturnValue(createMockQuery([INIT_MESSAGE, SUCCESS_RESULT]));
    const reporter: ActivityReporter = vi.fn().mockResolvedValue(undefined);
    const runner = new AgentRunner(reporter, 'http://localhost:3001');

    await runner.spawn('agent-1', 'Hello', 'agent-token', 'agent-name');
    // Let the async generator run
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should have called query with correct options
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const call = mockQuery.mock.calls[0][0];
    expect(call.prompt).toBe('Hello');
    expect(call.options.allowedTools).toContain('mcp__flock__');
    expect(call.options.permissionMode).toBe('bypassPermissions');
    expect(call.options.mcpServers.flock).toBeDefined();
    expect(call.options.mcpServers.flock.env.AGENT_NAME).toBe('agent-name');
    expect(call.options.mcpServers.flock.env.AGENT_TOKEN).toBe('agent-token');

    // Should report active status
    const activeCall = vi.mocked(reporter).mock.calls.find((c) => c[2] === 'Agent active');
    expect(activeCall).toBeDefined();
    expect(activeCall?.[3]).toMatchObject({
      session_id: 'test-session-id',
      session_source: 'agent-sdk',
      model: 'claude-sonnet-4-6',
    });
  });

  it('resumes an existing session when sessionId is provided', async () => {
    mockQuery.mockReturnValue(createMockQuery([INIT_MESSAGE, SUCCESS_RESULT]));
    const reporter: ActivityReporter = vi.fn().mockResolvedValue(undefined);
    const runner = new AgentRunner(reporter, 'http://localhost:3001');

    await runner.spawn('agent-1', 'Hello', 'agent-token', 'agent-name', {
      sessionId: 'existing-session-id',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const call = mockQuery.mock.calls[0][0];
    expect(call.options.resume).toBe('existing-session-id');
  });

  it('applies model and provider settings', async () => {
    mockQuery.mockReturnValue(createMockQuery([INIT_MESSAGE, SUCCESS_RESULT]));
    const reporter: ActivityReporter = vi.fn().mockResolvedValue(undefined);
    const runner = new AgentRunner(reporter, 'http://localhost:3001');

    await runner.spawn('agent-1', 'Hello', 'agent-token', 'agent-name', {
      model: 'claude-opus-4-6',
      provider: { name: 'custom-provider', env: { CUSTOM_KEY: 'value' } },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const call = mockQuery.mock.calls[0][0];
    expect(call.options.model).toBe('claude-opus-4-6');
    expect(call.options.env?.CUSTOM_KEY).toBe('value');
  });

  it('reports error when SDK query throws', async () => {
    mockQuery.mockReturnValue(createMockQuery([], { throwError: new Error('API key invalid') }));
    const reporter: ActivityReporter = vi.fn().mockResolvedValue(undefined);
    const runner = new AgentRunner(reporter, 'http://localhost:3001');

    await runner.spawn('agent-1', 'Hello', 'agent-token', 'agent-name');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(runner.isRunning('agent-1')).toBe(false);
    const errorCall = vi.mocked(reporter).mock.calls.find((c) => c[1] === 'error');
    expect(errorCall).toBeDefined();
    expect(errorCall?.[2]).toContain('API key invalid');
  });

  it('reports error when SDK returns error result', async () => {
    mockQuery.mockReturnValue(createMockQuery([INIT_MESSAGE, ERROR_RESULT]));
    const reporter: ActivityReporter = vi.fn().mockResolvedValue(undefined);
    const runner = new AgentRunner(reporter, 'http://localhost:3001');

    await runner.spawn('agent-1', 'Hello', 'agent-token', 'agent-name');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(runner.isRunning('agent-1')).toBe(false);
    const errorCall = vi.mocked(reporter).mock.calls.find((c) => c[1] === 'error');
    expect(errorCall).toBeDefined();
    expect(errorCall?.[2]).toContain('error_during_execution');
  });

  it('marks agent dormant on successful completion', async () => {
    mockQuery.mockReturnValue(createMockQuery([INIT_MESSAGE, SUCCESS_RESULT]));
    const reporter: ActivityReporter = vi.fn().mockResolvedValue(undefined);
    const runner = new AgentRunner(reporter, 'http://localhost:3001');

    await runner.spawn('agent-1', 'Hello', 'agent-token', 'agent-name');
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Agent should be dormant (completed), not deleted
    const agent = runner.getAgent('agent-1');
    expect(agent?.status).toBe('dormant');

    const dormantCall = vi.mocked(reporter).mock.calls.find((c) => c[2]?.includes('dormant'));
    expect(dormantCall).toBeDefined();
  });

  it('aborts the SDK query when stop() is called', async () => {
    // Create a generator that hangs (never yields)
    mockQuery.mockReturnValue((async function* () {
      yield INIT_MESSAGE;
      // Then hang indefinitely
      await new Promise(() => {});
    })());

    const reporter: ActivityReporter = vi.fn().mockResolvedValue(undefined);
    const runner = new AgentRunner(reporter, 'http://localhost:3001');

    await runner.spawn('agent-1', 'Hello', 'agent-token', 'agent-name');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(runner.isRunning('agent-1')).toBe(true);

    const stopped = await runner.stop('agent-1');
    expect(stopped).toBe(true);
    expect(runner.isRunning('agent-1')).toBe(false);

    const stopCall = vi.mocked(reporter).mock.calls.find((c) => c[2] === 'Agent stopped');
    expect(stopCall).toBeDefined();
  });
});
