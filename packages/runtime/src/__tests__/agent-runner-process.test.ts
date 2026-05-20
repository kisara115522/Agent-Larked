import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActivityReporter } from '../agent-runner.js';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

const { AgentRunner } = await import('../agent-runner.js');

class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 777;
  killed = false;
  kill = vi.fn();
}

describe('AgentRunner process reporting', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('reports the real CLI failure output when Claude exits non-zero', async () => {
    const child = new MockChildProcess();
    spawnMock.mockReturnValue(child);
    const reporter: ActivityReporter = vi.fn().mockResolvedValue(undefined);
    const runner = new AgentRunner(reporter, 'http://localhost:3001');

    await runner.spawn('agent-1', 'Introduce yourself', 'agent-token', 'agent-name');
    await new Promise((resolve) => setImmediate(resolve));

    const spawnOptions = spawnMock.mock.calls[0]?.[2];
    expect(spawnOptions?.stdio?.[0]).toBe('ignore');

    child.stderr.emit('data', Buffer.from('Warning: no stdin data received in 3s\n'));
    child.stdout.emit('data', Buffer.from('Failed to authenticate. API Error: 403 insufficient prepaid balance\n'));
    child.emit('close', 1);
    await new Promise((resolve) => setImmediate(resolve));

    const errorCall = vi.mocked(reporter).mock.calls.find((call) => call[1] === 'error');
    expect(errorCall).toBeDefined();
    expect(errorCall?.[2]).toContain('API Error: 403 insufficient prepaid balance');
    expect(errorCall?.[3]).toMatchObject({
      stdout: expect.stringContaining('Failed to authenticate'),
      stderr: expect.stringContaining('Warning: no stdin'),
    });
  });

  it('applies model and provider settings to the Claude child process', async () => {
    const child = new MockChildProcess();
    spawnMock.mockReturnValue(child);
    const reporter: ActivityReporter = vi.fn().mockResolvedValue(undefined);
    const runner = new AgentRunner(reporter, 'http://localhost:3001');

    await runner.spawn('agent-1', 'Hello', 'agent-token', 'agent-name', {
      model: 'opus',
      provider: {
        env: {
          ANTHROPIC_BASE_URL: 'https://provider.example/anthropic',
          ANTHROPIC_AUTH_TOKEN: 'provider-token',
        },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));

    const args = spawnMock.mock.calls[0]?.[1] as string[];
    const spawnOptions = spawnMock.mock.calls[0]?.[2];
    expect(args).toContain('--model');
    expect(args).toContain('opus');
    const settingsIndex = args.indexOf('--settings');
    expect(settingsIndex).toBeGreaterThan(-1);
    expect(JSON.parse(args[settingsIndex + 1])).toEqual({
      env: {
        ANTHROPIC_BASE_URL: 'https://provider.example/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'provider-token',
      },
    });
    expect(spawnOptions?.env?.AGENT_PROVIDER).toBe('custom');
  });
});
