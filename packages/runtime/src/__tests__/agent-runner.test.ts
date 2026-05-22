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
    // Mock spawn to avoid actually running claude
    const originalRunAgent = (runner as any).runAgent.bind(runner);
    (runner as any).runAgent = vi.fn();

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
    (runner as any).runAgent = vi.fn();

    const session1 = await runner.spawn('agent-1', 'Hello');
    // Simulate the process starting (runAgent would do this normally)
    const agent = runner.getAgent('agent-1');
    if (agent) agent.status = 'active';

    const session2 = await runner.spawn('agent-1', 'Hello again');

    expect(session1).toBe(session2);
    expect(runner.getAllAgents()).toHaveLength(1);
  });

  it('should not spawn a duplicate process while an agent is still spawning', async () => {
    const runAgent = vi.fn();
    (runner as any).runAgent = runAgent;

    const session1 = await runner.spawn('agent-1', 'Hello');
    const session2 = await runner.spawn('agent-1', 'Hello again');

    expect(session1).toBe(session2);
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runner.getAllAgents()).toHaveLength(1);
  });
});
