import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FlockAgentRuntime } from '../runtime.js';
import type { RuntimeConfig } from '../config.js';

describe('FlockAgentRuntime registration', () => {
  const config: RuntimeConfig = {
    flockServerUrl: 'http://localhost:3001',
    callbackHost: '127.0.0.1',
    callbackPort: 0,
    callbackSecret: null,
    maxAgents: 10,
    heartbeatIntervalMs: 30_000,
    dbPath: '',
  };

  beforeEach(() => {
    vi.useFakeTimers();
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
    const runtime = new FlockAgentRuntime(config);
    const stopSpy = vi.spyOn(runtime, 'stop').mockResolvedValue(undefined);

    const startPromise = runtime.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    await runtime.stop();
    expect(stopSpy).toHaveBeenCalled();
  });
});
