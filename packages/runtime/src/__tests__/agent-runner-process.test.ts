import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActivityReporter } from '../agent-runner.js';

// ─── Fake child process (mirrors claude-stdio.test.ts harness) ────────────────

interface FakeWritable extends EventEmitter {
  writes: string[];
  write(data: string): boolean;
  end(): void;
}

interface FakeReadable extends EventEmitter {
  setEncoding(enc: string): void;
  resume(): void;
  pause(): void;
  pipe(): void;
}

interface FakeChild extends EventEmitter {
  pid: number;
  stdin: FakeWritable;
  stdout: FakeReadable;
  stderr: FakeReadable;
  killed: boolean;
  kill(sig?: string): boolean;
  pushLine(line: string): void;
  pushStderr(data: string): void;
}

function makeFakeChild(pid = 9999): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.killed = false;

  const stdin = new EventEmitter() as FakeWritable;
  stdin.writes = [];
  stdin.write = (data: string) => { stdin.writes.push(data); return true; };
  stdin.end = () => { /* noop */ };
  child.stdin = stdin;

  const stdout = new EventEmitter() as FakeReadable;
  stdout.setEncoding = () => {};
  stdout.resume = () => {};
  stdout.pause = () => {};
  stdout.pipe = () => {};
  child.stdout = stdout;

  const stderr = new EventEmitter() as FakeReadable;
  stderr.setEncoding = () => {};
  child.stderr = stderr;

  child.kill = (sig = 'SIGTERM') => {
    child.killed = true;
    Promise.resolve().then(() => child.emit('exit', null, sig));
    return true;
  };
  child.pushLine = (line: string) => child.stdout.emit('data', line + '\n');
  child.pushStderr = (data: string) => child.stderr.emit('data', data);

  return child;
}

// ─── spawn mock ───────────────────────────────────────────────────────────────

const fakeChildren: FakeChild[] = [];
const spawnCalls: { command: string; args: string[]; opts: Record<string, unknown> }[] = [];

vi.mock('node:child_process', () => ({
  spawn: (command: string, args: string[], opts: Record<string, unknown>) => {
    spawnCalls.push({ command, args, opts });
    return fakeChildren.shift() ?? makeFakeChild();
  },
}));

// Block real filesystem MCP config writes
vi.mock('../backends/mcp-config.js', () => ({
  writeMcpConfigToTemp: () => ({ path: '/tmp/fake-mcp.json', cleanup: vi.fn() }),
}));

const { AgentRunner } = await import('../agent-runner.js');

// ─── Wire protocol fixtures ───────────────────────────────────────────────────

const INIT_LINE = JSON.stringify({
  type: 'system',
  subtype: 'init',
  session_id: 'test-session-id',
  model: 'claude-sonnet-4-6',
  tools: ['Read', 'Edit', 'Bash'],
  mcp_servers: [{ name: 'flock', status: 'connected' }],
});

const SUCCESS_RESULT = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 5000,
  num_turns: 3,
  session_id: 'test-session-id',
  total_cost_usd: 0.01,
});

const ERROR_RESULT = JSON.stringify({
  type: 'result',
  subtype: 'error_during_execution',
  is_error: true,
  duration_ms: 1000,
  session_id: 'test-session-id',
  total_cost_usd: 0.001,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Wait a macrotask so the spawned async generator can process pushed lines */
function tick(ms = 100): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── C56: init/active + resume ────────────────────────────────────────────────

describe('AgentRunner stdio integration', () => {
  beforeEach(() => {
    fakeChildren.length = 0;
    spawnCalls.length = 0;
  });

  it('C56a: reports active on init and surfaces session_id', async () => {
    const child = makeFakeChild(1001);
    fakeChildren.push(child);

    const reporter: ActivityReporter = vi.fn().mockResolvedValue(undefined);
    const runner = new AgentRunner(reporter, 'http://localhost:3001');

    await runner.spawn('agent-1', 'Hello', 'agent-token', 'agent-name');
    child.pushLine(INIT_LINE);
    child.pushLine(SUCCESS_RESULT);
    child.emit('exit', 0, null);
    await tick();

    const activeCall = vi.mocked(reporter).mock.calls.find((c) => c[2] === 'Agent active');
    expect(activeCall).toBeDefined();
    expect(activeCall?.[3]).toMatchObject({
      session_id: 'test-session-id',
      session_source: 'agent-harness',
      model: 'claude-sonnet-4-6',
    });
  });

  it('C56b: passes --resume in spawn argv when sessionId is provided', async () => {
    const child = makeFakeChild(1002);
    fakeChildren.push(child);

    const reporter: ActivityReporter = vi.fn().mockResolvedValue(undefined);
    const runner = new AgentRunner(reporter, 'http://localhost:3001');

    await runner.spawn('agent-1', 'Hello', 'agent-token', 'agent-name', {
      sessionId: 'existing-session-id',
    });
    child.pushLine(INIT_LINE);
    child.pushLine(SUCCESS_RESULT);
    child.emit('exit', 0, null);
    await tick();

    expect(spawnCalls.length).toBeGreaterThan(0);
    const args = spawnCalls[0].args;
    const idx = args.indexOf('--resume');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('existing-session-id');
  });

  // ─── C57: model/provider env ────────────────────────────────────────────────

  it('C57a: passes --model in spawn argv when model is specified', async () => {
    const child = makeFakeChild(1003);
    fakeChildren.push(child);

    const reporter: ActivityReporter = vi.fn().mockResolvedValue(undefined);
    const runner = new AgentRunner(reporter, 'http://localhost:3001');

    await runner.spawn('agent-1', 'Hello', 'agent-token', 'agent-name', {
      model: 'claude-opus-4-8',
    });
    child.pushLine(INIT_LINE);
    child.pushLine(SUCCESS_RESULT);
    child.emit('exit', 0, null);
    await tick();

    const args = spawnCalls[0].args;
    const idx = args.indexOf('--model');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('claude-opus-4-8');
  });

  it('C57b: provider env is passed in child env', async () => {
    const child = makeFakeChild(1004);
    fakeChildren.push(child);

    const reporter: ActivityReporter = vi.fn().mockResolvedValue(undefined);
    const runner = new AgentRunner(reporter, 'http://localhost:3001');

    await runner.spawn('agent-1', 'Hello', 'agent-token', 'agent-name', {
      provider: { name: 'custom-provider', env: { CUSTOM_KEY: 'value' } },
    });
    child.pushLine(INIT_LINE);
    child.pushLine(SUCCESS_RESULT);
    child.emit('exit', 0, null);
    await tick();

    const spawnEnv = spawnCalls[0].opts.env as Record<string, string> | undefined;
    expect(spawnEnv?.CUSTOM_KEY).toBe('value');
  });

  // ─── C58: error paths ────────────────────────────────────────────────────────

  it('C58a: reports error when process exits without result', async () => {
    const child = makeFakeChild(1005);
    fakeChildren.push(child);

    const reporter: ActivityReporter = vi.fn().mockResolvedValue(undefined);
    const runner = new AgentRunner(reporter, 'http://localhost:3001');

    await runner.spawn('agent-1', 'Hello', 'agent-token', 'agent-name');
    child.pushStderr('API key invalid');
    child.emit('exit', 1, null);
    await tick();

    expect(runner.isRunning('agent-1')).toBe(false);
    const errorCall = vi.mocked(reporter).mock.calls.find((c) => c[1] === 'error');
    expect(errorCall).toBeDefined();
    expect(errorCall?.[2]).toContain('API key invalid');
  });

  it('C58b: reports error when result subtype is error', async () => {
    const child = makeFakeChild(1006);
    fakeChildren.push(child);

    const reporter: ActivityReporter = vi.fn().mockResolvedValue(undefined);
    const runner = new AgentRunner(reporter, 'http://localhost:3001');

    await runner.spawn('agent-1', 'Hello', 'agent-token', 'agent-name');
    child.pushLine(INIT_LINE);
    child.pushLine(ERROR_RESULT);
    child.emit('exit', 0, null);
    await tick();

    expect(runner.isRunning('agent-1')).toBe(false);
    const errorCall = vi.mocked(reporter).mock.calls.find((c) => c[1] === 'error');
    expect(errorCall).toBeDefined();
    expect(errorCall?.[2]).toContain('error_during_execution');
  });

  // ─── C59: lifecycle ──────────────────────────────────────────────────────────

  it('C59a: marks agent dormant on successful completion', async () => {
    const child = makeFakeChild(1007);
    fakeChildren.push(child);

    const reporter: ActivityReporter = vi.fn().mockResolvedValue(undefined);
    const runner = new AgentRunner(reporter, 'http://localhost:3001');

    await runner.spawn('agent-1', 'Hello', 'agent-token', 'agent-name');
    child.pushLine(INIT_LINE);
    child.pushLine(SUCCESS_RESULT);
    child.emit('exit', 0, null);
    await tick();

    const agent = runner.getAgent('agent-1');
    expect(agent).toBeUndefined();

    const dormantCall = vi.mocked(reporter).mock.calls.find((c) => c[2]?.includes('dormant'));
    expect(dormantCall).toBeDefined();
  });

  it('C59b: stop() kills child and reports stopped', async () => {
    const child = makeFakeChild(1008);
    fakeChildren.push(child);

    const reporter: ActivityReporter = vi.fn().mockResolvedValue(undefined);
    const runner = new AgentRunner(reporter, 'http://localhost:3001');

    await runner.spawn('agent-1', 'Hello', 'agent-token', 'agent-name');
    child.pushLine(INIT_LINE);
    await tick(20);

    expect(runner.isRunning('agent-1')).toBe(true);

    const stopped = await runner.stop('agent-1');
    expect(stopped).toBe(true);
    expect(runner.isRunning('agent-1')).toBe(false);
    expect(child.killed).toBe(true);

    const stopCall = vi.mocked(reporter).mock.calls.find((c) => c[2] === 'Agent stopped');
    expect(stopCall).toBeDefined();
  });

  it('C59c: abort via stop() does not report error', async () => {
    const child = makeFakeChild(1009);
    fakeChildren.push(child);

    const reporter: ActivityReporter = vi.fn().mockResolvedValue(undefined);
    const runner = new AgentRunner(reporter, 'http://localhost:3001');

    await runner.spawn('agent-1', 'Hello', 'agent-token', 'agent-name');
    child.pushLine(INIT_LINE);
    await tick(10);

    await runner.stop('agent-1');
    await tick(30);

    const errorCall = vi.mocked(reporter).mock.calls.find((c) => c[1] === 'error');
    expect(errorCall).toBeUndefined();

    const stopCall = vi.mocked(reporter).mock.calls.find((c) => c[2] === 'Agent stopped');
    expect(stopCall).toBeDefined();
  });
});
