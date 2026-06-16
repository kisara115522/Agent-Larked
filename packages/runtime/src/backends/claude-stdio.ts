/**
 * ClaudeStdioBackend — drives the claude CLI directly over stdio with the
 * stream-json protocol, replacing the in-process SDK query().
 *
 * Why stdio (see docs/plans/2026-06-16-stdio-backend-migration.md):
 *  - Full control of child argv + env (no parent-session env leakage).
 *  - stdin stays open so control_request can be answered on the same stream
 *    (and future mid-run message injection becomes possible).
 *  - Lifecycle/abort handled by us, not an SDK black box.
 *
 * Modeled on multica's claudeBackend (server/pkg/agent/claude.go).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type {
  AgentBackend,
  AgentRunContext,
  AgentEvent,
  BackendConfig,
} from './types.js';
import { buildChildEnv } from './child-env.js';
import { buildClaudeArgs } from './claude-args.js';
import { writeMcpConfigToTemp } from './mcp-config.js';
import { createEventQueue } from './event-queue.js';
import {
  buildUserInput,
  buildControlAllow,
  translateStreamMessage,
  type StreamJsonMessage,
} from './stream-json.js';

const CLAUDE_BIN = process.env.CLAUDE_CLI_PATH ?? 'claude';
const SIGKILL_GRACE_MS = 10_000; // mirrors multica cmd.WaitDelay

export class ClaudeStdioBackend implements AgentBackend {
  readonly name = 'claude-stdio';

  /** sessionId → child process, for abort(). Keyed by resume id first, then
   *  re-keyed to the real session id once the init event arrives. */
  private active = new Map<string, ChildProcessWithoutNullStreams>();

  run(ctx: AgentRunContext): AsyncIterable<AgentEvent> {
    return this.exec(ctx, undefined);
  }

  resume(sessionId: string, ctx: AgentRunContext): AsyncIterable<AgentEvent> {
    return this.exec(ctx, sessionId);
  }

  abort(sessionId: string): void {
    const child = this.active.get(sessionId);
    if (!child) return;
    this.active.delete(sessionId);
    this.killChild(child);
  }

  private killChild(child: ChildProcessWithoutNullStreams): void {
    try {
      child.stdin.end();
    } catch { /* ignore */ }
    child.kill('SIGTERM');
    const t = setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, SIGKILL_GRACE_MS);
    // Don't keep the event loop alive just for the grace timer.
    t.unref?.();
    child.once('exit', () => clearTimeout(t));
  }

  private async *exec(
    ctx: AgentRunContext,
    resumeSessionId: string | undefined,
  ): AsyncGenerator<AgentEvent> {
    const mcp = writeMcpConfigToTemp(ctx.mcpServers);
    const args = buildClaudeArgs(ctx, { mcpConfigPath: mcp.path, resumeSessionId });
    const env = buildChildEnv(ctx.env);

    const child = spawn(CLAUDE_BIN, args, {
      cwd: ctx.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    const queue = createEventQueue<AgentEvent>();
    let trackingKey = resumeSessionId ?? `pending:${child.pid}`;
    this.active.set(trackingKey, child);

    let sawResult = false;
    let stderrTail = '';
    const STDERR_TAIL_MAX = 8192;

    // ── stderr → bounded tail (for diagnostics on unexpected exit) ──
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_MAX);
    });

    // ── stdout → line parse ──
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: StreamJsonMessage;
      try {
        msg = JSON.parse(trimmed) as StreamJsonMessage;
      } catch {
        return; // non-JSON noise (banner etc.)
      }
      // control_request is answered out-of-band on stdin (auto-approve).
      if (msg.type === 'control_request' && msg.request_id) {
        try {
          child.stdin.write(buildControlAllow(msg.request_id, msg.request?.input));
        } catch { /* ignore */ }
        return;
      }

      for (const ev of translateStreamMessage(msg)) {
        // Re-key the active map to the real session id so abort() works.
        if (ev.type === 'init' && ev.sessionId) {
          this.active.delete(trackingKey);
          trackingKey = ev.sessionId;
          this.active.set(trackingKey, child);
        }
        if (ev.type === 'result') sawResult = true;
        queue.push(ev);
      }
    });

    // Write the initial user message. stdin stays OPEN (control_request needs
    // the same stream; closing early strands the child — multica's hard-won note).
    try {
      child.stdin.write(buildUserInput(ctx.prompt));
    } catch {
      // If the pipe is already broken the exit handler will surface the error.
    }

    // ── lifecycle: finish() closes the queue and cleans up ──
    let finished = false;
    const finish = (extra?: AgentEvent): void => {
      if (finished) return;
      finished = true;
      if (extra) queue.push(extra);
      queue.end();
      this.active.delete(trackingKey);
      mcp.cleanup();
    };

    // ctx.signal abort → kill child (covers harness/shutdown abort).
    if (ctx.signal.aborted) {
      this.killChild(child);
    } else {
      ctx.signal.addEventListener('abort', () => this.killChild(child), { once: true });
    }

    child.once('error', (err: Error) => {
      rl.close();
      finish({ type: 'error', message: `spawn claude: ${err.message}`, subtype: 'unknown' });
    });

    child.once('exit', (code, signal) => {
      rl.close();
      if (sawResult) {
        finish();
        return;
      }
      // Process ended without a result frame.
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        finish({ type: 'error', message: 'aborted', subtype: 'abort' });
      } else {
        const tail = stderrTail.trim();
        finish({
          type: 'error',
          message: `claude exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})${tail ? `: ${tail}` : ''}`,
          subtype: 'unknown',
        });
      }
    });

    yield* queue.drain();
  }
}

export function createClaudeStdioBackend(_config?: BackendConfig): ClaudeStdioBackend {
  return new ClaudeStdioBackend();
}

