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

  abort(_sessionId: string): void {
    // TODO: implemented in subsequent commits
  }

  private killChild(_child: ChildProcessWithoutNullStreams): void {
    // TODO: implemented in subsequent commits
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

    // Cleanup and exit — more wiring in subsequent commits.
    mcp.cleanup();
    child.kill('SIGTERM');
  }
}

export function createClaudeStdioBackend(_config?: BackendConfig): ClaudeStdioBackend {
  return new ClaudeStdioBackend();
}

// Suppress unused-import warnings for helpers used in later commits.
void (createEventQueue as unknown);
void (buildUserInput as unknown);
void (buildControlAllow as unknown);
void (translateStreamMessage as unknown);
void (createInterface as unknown);
void (SIGKILL_GRACE_MS as unknown);
