import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeConfig } from '../config.js';

const mockSpawn = vi.fn().mockResolvedValue('mock-session');
const mockStop = vi.fn().mockResolvedValue(false);
const mockShutdown = vi.fn().mockResolvedValue(undefined);

vi.mock('../agent-runner.js', () => ({
  AgentRunner: vi.fn().mockImplementation(function AgentRunnerMock() {
    return {
      spawn: mockSpawn,
      stop: mockStop,
      shutdown: mockShutdown,
    };
  }),
}));

const { FlockAgentRuntime } = await import('../runtime.js');

describe('FlockAgentRuntime registration', () => {
  function makeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
    return {
      flockServerUrl: 'http://localhost:3001',
      callbackHost: '127.0.0.1',
      callbackPort: 0,
      callbackSecret: null,
      registrationSecret: null,
      maxAgents: 10,
      heartbeatIntervalMs: 30_000,
      dbPath: '',
      defaultBackend: { type: 'claude-sdk' },
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    mockSpawn.mockClear();
    mockStop.mockClear();
    mockShutdown.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries registration when the server is not ready yet', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:3001'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'runtime-1', callback_secret: 'secret-1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }));
    const runtime = new FlockAgentRuntime(makeConfig());
    const stopSpy = vi.spyOn(runtime, 'stop').mockResolvedValue(undefined);

    const startPromise = runtime.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    await runtime.stop();
    expect(stopSpy).toHaveBeenCalled();
  });

  it('persists the callback secret and sends it on restart', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'flock-runtime-'));
    const callbackSecretPath = join(tempDir, 'callback-secrets.json');
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ id: 'runtime-1', callback_secret: 'persisted-secret' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      });

    try {
      const firstRuntime = new FlockAgentRuntime(makeConfig({ callbackSecretPath }));
      await firstRuntime.start();
      await firstRuntime.stop();

      const restartedRuntime = new FlockAgentRuntime(makeConfig({ callbackSecretPath }));
      await restartedRuntime.start();
      await restartedRuntime.stop();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(bodies[0].callback_secret).toBeUndefined();
      expect(bodies[1].callback_secret).toBe('persisted-secret');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('spawns through AgentRunner with configured default backend and provider env', async () => {
    const runtime = new FlockAgentRuntime({
      ...makeConfig(),
      defaultBackend: {
        type: 'openai-compat',
        apiEndpoint: 'https://api.example.test/v1',
        apiKey: 'sk-test',
        model: 'deepseek-chat',
      },
    });

    await (runtime as unknown as {
      handleCallback(event: {
        type: 'spawn';
        agent_id: string;
        agent_token: string;
        agent_name: string;
        agent_provider: { name: string; env: Record<string, string> };
        prompt: string;
      }): Promise<void>;
    }).handleCallback({
      type: 'spawn',
      agent_id: 'agent-1',
      agent_token: 'agent-token',
      agent_name: 'RuntimeBot',
      agent_provider: {
        name: 'custom-provider',
        env: { OPENAI_API_KEY: 'provider-key' },
      },
      prompt: 'Run with configured backend',
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'agent-1',
      expect.stringContaining('Run with configured backend'),
      'agent-token',
      'RuntimeBot',
      expect.objectContaining({
        backendConfig: expect.objectContaining({
          type: 'openai-compat',
          apiEndpoint: 'https://api.example.test/v1',
          apiKey: 'sk-test',
          model: 'deepseek-chat',
        }),
        provider: {
          name: 'custom-provider',
          env: { OPENAI_API_KEY: 'provider-key' },
        },
      }),
    );
  });
});
