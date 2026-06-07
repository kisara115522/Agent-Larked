import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRunner, type ActivityReporter } from '../agent-runner.js';

describe('AgentRunner', () => {
  let reporter: ActivityReporter;
  let runner: AgentRunner;

  beforeEach(() => {
    reporter = vi.fn().mockResolvedValue(undefined);
    runner = new AgentRunner(reporter, 'http://localhost:3001');
  });

  it('should track agent status', () => {
    expect(runner.isRunning('agent-1')).toBe(false);
    expect(runner.getAgent('agent-1')).toBeUndefined();
    expect(runner.getAllAgents()).toEqual([]);
  });

  it('should not stop a non-existent agent', async () => {
    const result = await runner.stop('non-existent');
    expect(result).toBe(false);
  });

  it('should report activity on spawn', async () => {
    const sessionPromise = new Promise(() => {});
    (runner as any).harness.spawn = vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      abortController: new AbortController(),
      promise: sessionPromise,
    });

    await runner.spawn('agent-1', 'Hello');

    expect(reporter).toHaveBeenCalledWith(
      'agent-1',
      'status_change',
      'Agent spawning',
      expect.objectContaining({ session_id: expect.any(String) }),
      undefined,
    );
  });

  it('should not spawn duplicate agent', async () => {
    const sessionPromise = new Promise(() => {});
    (runner as any).harness.spawn = vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      abortController: new AbortController(),
      promise: sessionPromise,
    });

    const session1 = await runner.spawn('agent-1', 'Hello');
    const session2 = await runner.spawn('agent-1', 'Hello again');

    expect(session1).toBe(session2);
    expect(runner.getAllAgents()).toHaveLength(1);
  });

  it('should not spawn a duplicate process while an agent is still spawning', async () => {
    let resolveHarnessSpawn: (session: unknown) => void;
    const harnessSpawnPromise = new Promise((resolve) => {
      resolveHarnessSpawn = resolve;
    });
    const harnessSpawn = vi.fn().mockReturnValue(harnessSpawnPromise);
    (runner as any).harness.spawn = harnessSpawn;

    const session1Promise = runner.spawn('agent-1', 'Hello');
    await Promise.resolve();
    const session2 = await runner.spawn('agent-1', 'Hello again');
    const instance = runner.getAgent('agent-1');
    resolveHarnessSpawn!({
      sessionId: instance!.sessionId,
      abortController: new AbortController(),
      promise: new Promise(() => {}),
    });
    const session1 = await session1Promise;

    expect(session1).toBe(session2);
    expect(harnessSpawn).toHaveBeenCalledTimes(1);
    expect(runner.getAllAgents()).toHaveLength(1);
  });
});
