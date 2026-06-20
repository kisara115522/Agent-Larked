/**
 * Tests for ClaudeStdioBackend.
 *
 * All tests use a fake child process (EventEmitter-based mock) so no real
 * claude CLI invocation occurs.
 */
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentRunContext } from '../backends/types.js';

// ─── Fake child process ───────────────────────────────────────────────────────

interface FakeReadable extends EventEmitter {
  setEncoding(enc: string): void;
}

interface FakeWritable extends EventEmitter {
  writes: string[];
  write(data: string): boolean;
  end(): void;
}

interface FakeChild extends EventEmitter {
  pid: number;
  stdin: FakeWritable;
  stdout: FakeReadable;
  stderr: FakeReadable;
  killed: boolean;
  kill(sig?: string): boolean;
  /** Test helper: push a line to stdout listeners */
  pushLine(line: string): void;
  /** Test helper: push to stderr */
  pushStderr(data: string): void;
}

function makeFakeChild(pid = 12345): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.killed = false;

  const stdin = new EventEmitter() as FakeWritable;
  stdin.writes = [];
  stdin.write = (data: string) => { stdin.writes.push(data); return true; };
  stdin.end = () => { /* noop */ };
  child.stdin = stdin;

  const stdout = new EventEmitter() as FakeReadable & { resume(): void; pause(): void; pipe(): void };
  stdout.setEncoding = () => {};
  stdout.resume = () => {};  // required by createInterface
  stdout.pause = () => {};   // required by rl.close()
  stdout.pipe = () => {};
  child.stdout = stdout;

  const stderr = new EventEmitter() as FakeReadable;
  stderr.setEncoding = () => {};
  child.stderr = stderr;

  child.kill = (sig = 'SIGTERM') => {
    child.killed = true;
    // Simulate async exit after kill
    Promise.resolve().then(() => child.emit('exit', null, sig));
    return true;
  };

  // readline uses the 'line' event — we emit on stdout directly
  // BUT createInterface listens on 'data' not 'line', so we simulate lines
  // by emitting 'data' chunks that readline will parse.
  child.pushLine = (line: string) => {
    child.stdout.emit('data', line + '\n');
  };

  child.pushStderr = (data: string) => {
    child.stderr.emit('data', data);
  };

  return child;
}

// ─── Mock child_process.spawn ─────────────────────────────────────────────────

const fakeChildren: FakeChild[] = [];
let spawnArgs: { command: string; args: string[]; opts: Record<string, unknown> }[] = [];

vi.mock('node:child_process', () => ({
  spawn: (command: string, args: string[], opts: Record<string, unknown>) => {
    spawnArgs.push({ command, args, opts });
    const child = fakeChildren.shift() ?? makeFakeChild();
    return child;
  },
}));

// Mock writeMcpConfigToTemp so tests don't hit the filesystem
vi.mock('../backends/mcp-config.js', () => ({
  writeMcpConfigToTemp: () => ({ path: '/tmp/fake-mcp.json', cleanup: vi.fn() }),
}));

const { ClaudeStdioBackend } = await import('../backends/claude-stdio.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

async function collectEvents(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const ev of iterable) {
    events.push(ev);
  }
  return events;
}

const INIT_LINE = JSON.stringify({
  type: 'system',
  subtype: 'init',
  session_id: 'real-session-id',
  model: 'claude-opus-4-8',
  tools: ['Bash', 'Read'],
  mcp_servers: [{ name: 'flock', status: 'connected' }],
});

const TEXT_LINE = JSON.stringify({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello there' }],
  },
  session_id: 'real-session-id',
});

const RESULT_LINE = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 1000,
  num_turns: 1,
  session_id: 'real-session-id',
  total_cost_usd: 0.01,
});

// ─── C39: smoke test ──────────────────────────────────────────────────────────

describe('ClaudeStdioBackend', () => {
  beforeEach(() => {
    fakeChildren.length = 0;
    spawnArgs.length = 0;
  });

  describe('run() smoke test: init → text → result', () => {
    it('emits init, text, result events in order', async () => {
      const child = makeFakeChild(1001);
      fakeChildren.push(child);

      const backend = new ClaudeStdioBackend();
      const runPromise = collectEvents(backend.run(baseCtx()));

      // Push lines after the stream starts
      await Promise.resolve();
      child.pushLine(INIT_LINE);
      child.pushLine(TEXT_LINE);
      child.pushLine(RESULT_LINE);
      child.emit('exit', 0, null);

      const events = await runPromise;
      expect(events.map((e) => (e as { type: string }).type)).toEqual(['init', 'text', 'result']);
    });
  });

  // C40: init event re-keys active map
  describe('init event re-keys active map for abort()', () => {
    it('abort() with real session id kills the child', async () => {
      const child = makeFakeChild(1002);
      fakeChildren.push(child);

      const backend = new ClaudeStdioBackend();
      const runPromise = collectEvents(backend.run(baseCtx()));

      await Promise.resolve();
      child.pushLine(INIT_LINE); // sets trackingKey to 'real-session-id'
      await Promise.resolve();

      backend.abort('real-session-id');
      // child.kill was called
      expect(child.killed).toBe(true);

      await runPromise; // should complete (exit emitted by kill mock)
    });
  });

  // C41: result is_error maps to error
  describe('result with is_error:true → error_during_execution', () => {
    it('emits result with subtype error_during_execution', async () => {
      const child = makeFakeChild(1003);
      fakeChildren.push(child);

      const errorResultLine = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: true,
        duration_ms: 100,
        session_id: 'real-session-id',
      });

      const backend = new ClaudeStdioBackend();
      const runPromise = collectEvents(backend.run(baseCtx()));

      await Promise.resolve();
      child.pushLine(INIT_LINE);
      child.pushLine(errorResultLine);
      child.emit('exit', 0, null);

      const events = await runPromise;
      const resultEv = events.find((e) => (e as { type: string }).type === 'result') as {
        type: string;
        subtype: string;
      } | undefined;
      expect(resultEv).toBeDefined();
      expect(resultEv?.subtype).toBe('error_during_execution');
    });
  });

  // C42: control_request writes allow to stdin
  describe('control_request → writes control_response allow to stdin', () => {
    it('stdin receives allow response with matching request_id', async () => {
      const child = makeFakeChild(1004);
      fakeChildren.push(child);

      const controlLine = JSON.stringify({
        type: 'control_request',
        request_id: 'req-xyz',
        request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { cmd: 'ls' } },
      });

      const backend = new ClaudeStdioBackend();
      const runPromise = collectEvents(backend.run(baseCtx()));

      await Promise.resolve();
      child.pushLine(INIT_LINE);
      child.pushLine(controlLine);
      child.pushLine(RESULT_LINE);
      child.emit('exit', 0, null);

      await runPromise;

      // stdin should have received the initial prompt + control_response
      const controlResponse = child.stdin.writes.find((w) => w.includes('control_response'));
      expect(controlResponse).toBeDefined();
      const parsed = JSON.parse(controlResponse!) as Record<string, unknown>;
      expect(parsed.type).toBe('control_response');
      const resp = (parsed.response as Record<string, unknown>).response as Record<string, unknown>;
      expect(resp.behavior).toBe('allow');
    });
  });

  // C43: abort kills child + emits abort error
  describe('abort() kills child and stream emits abort error', () => {
    it('produces error with subtype abort when killed via abort()', async () => {
      const child = makeFakeChild(1005);
      fakeChildren.push(child);

      const backend = new ClaudeStdioBackend();
      const runPromise = collectEvents(backend.run(baseCtx()));

      await Promise.resolve();
      child.pushLine(INIT_LINE);
      await Promise.resolve();

      backend.abort('real-session-id');

      const events = await runPromise;
      const errEv = events.find((e) => (e as { type: string }).type === 'error') as {
        type: string;
        subtype: string;
        message: string;
      } | undefined;
      expect(errEv).toBeDefined();
      expect(errEv?.subtype).toBe('abort');
    });
  });

  // C44: resume passes --resume in argv
  describe('resume() passes --resume in argv', () => {
    it('spawn argv contains --resume <sessionId>', async () => {
      const child = makeFakeChild(1006);
      fakeChildren.push(child);

      const backend = new ClaudeStdioBackend();
      const runPromise = collectEvents(backend.resume('prev-session', baseCtx()));

      await Promise.resolve();
      child.pushLine(INIT_LINE);
      child.pushLine(RESULT_LINE);
      child.emit('exit', 0, null);

      await runPromise;

      expect(spawnArgs.length).toBeGreaterThan(0);
      const args = spawnArgs[0].args;
      const idx = args.indexOf('--resume');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('prev-session');
    });
  });

  // C45: exit-without-result synthesizes error
  describe('exit without result → error event with stderr tail', () => {
    it('synthesizes unknown error with stderr content', async () => {
      const child = makeFakeChild(1007);
      fakeChildren.push(child);

      const backend = new ClaudeStdioBackend();
      const runPromise = collectEvents(backend.run(baseCtx()));

      await Promise.resolve();
      child.pushStderr('fatal: something went wrong');
      child.emit('exit', 1, null);

      const events = await runPromise;
      const errEv = events.find((e) => (e as { type: string }).type === 'error') as {
        type: string;
        subtype: string;
        message: string;
      } | undefined;
      expect(errEv).toBeDefined();
      expect(errEv?.subtype).toBe('unknown');
      expect(errEv?.message).toContain('fatal: something went wrong');
    });
  });

  describe('hook settings + env injection', () => {
    it('spawn argv contains --settings', async () => {
      const child = makeFakeChild(1008);
      fakeChildren.push(child);

      const backend = new ClaudeStdioBackend();
      const runPromise = collectEvents(backend.run(baseCtx({ agentId: 'test-agent', dbPath: '/tmp/test.db' })));

      await Promise.resolve();
      child.pushLine(INIT_LINE);
      child.pushLine(RESULT_LINE);
      child.emit('exit', 0, null);

      await runPromise;
      expect(spawnArgs.length).toBeGreaterThan(0);
      const args = spawnArgs[0].args;
      const idx = args.indexOf('--settings');
      expect(idx).toBeGreaterThan(-1);
      // settings path should be a temp file
      expect(args[idx + 1]).toContain('flock-hooks-');
    });

    it('spawn env contains FLOCK_AGENT_ID', async () => {
      const child = makeFakeChild(1009);
      fakeChildren.push(child);

      const backend = new ClaudeStdioBackend();
      const runPromise = collectEvents(backend.run(baseCtx({ agentId: 'my-agent', dbPath: '/tmp/test.db' })));

      await Promise.resolve();
      child.pushLine(INIT_LINE);
      child.pushLine(RESULT_LINE);
      child.emit('exit', 0, null);

      await runPromise;
      expect(spawnArgs.length).toBeGreaterThan(0);
      const env = spawnArgs[0].opts.env as Record<string, string>;
      expect(env.FLOCK_AGENT_ID).toBe('my-agent');
      expect(env.DB_PATH).toBe('/tmp/test.db');
    });
  });
});
