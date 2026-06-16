/**
 * ClaudeSdkBackend — implements AgentBackend using @anthropic-ai/claude-agent-sdk.
 *
 * This wraps the existing SDK query() generator into the unified AgentBackend
 * interface. The SDK manages its own tool loop internally (Read, Edit, Bash,
 * etc. + MCP tools), so we simply translate SDK messages into AgentEvents.
 *
 * Key behaviors:
 *  - Maps SDK message types → unified AgentEvent stream
 *  - Supports resume via sessionId
 *  - Delegates tool execution entirely to the SDK (toolExecutor is unused)
 *  - Converts MCP server configs to SDK format
 *  - Yields ALL content blocks from multi-block messages (not just the first)
 */

import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentBackend,
  AgentRunContext,
  AgentEvent,
  MCPServerConfig,
} from './types.js';
import { isInternalClaudeEnvKey } from './child-env.js';

// ─── Default allowed tools ──────────────────────────────────────────────────

const DEFAULT_ALLOWED_TOOLS = [
  'Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'WebFetch',
  'mcp__flock__',
];

// ─── Implementation ─────────────────────────────────────────────────────────

export class ClaudeSdkBackend implements AgentBackend {
  readonly name = 'claude-sdk';

  private activeAbortControllers = new Map<string, AbortController>();

  run(ctx: AgentRunContext): AsyncIterable<AgentEvent> {
    return this.createQuery(ctx, false);
  }

  abort(sessionId: string): void {
    const ac = this.activeAbortControllers.get(sessionId);
    if (ac) {
      ac.abort();
      this.activeAbortControllers.delete(sessionId);
    }
  }

  resume(sessionId: string, ctx: AgentRunContext): AsyncIterable<AgentEvent> {
    return this.createQuery(ctx, true, sessionId);
  }

  /**
   * Core implementation: creates the SDK query and yields unified events.
   */
  private async *createQuery(
    ctx: AgentRunContext,
    isResume: boolean,
    resumeSessionId?: string,
  ): AsyncIterable<AgentEvent> {
    const mcpServers = buildMcpServersConfig(ctx.mcpServers);
    const abortController = toAbortController(ctx.signal);

    const result = query({
      prompt: ctx.prompt,
      options: {
        cwd: ctx.cwd,
        allowedTools: ctx.allowedTools ?? DEFAULT_ALLOWED_TOOLS,
        permissionMode: resolvePermissionMode(ctx.permissionMode),
        allowDangerouslySkipPermissions: true,
        abortController,
        model: ctx.model,
        env: stripInternalEnv(ctx.env ? { ...process.env, ...ctx.env } : process.env),
        mcpServers,
        settingSources: [],
        // Use preset to preserve Claude Code's internal system prompt (stream-json protocol,
        // tool usage instructions, etc.). Passing a plain string replaces the default entirely,
        // which breaks multi-turn sessions because the protocol instructions disappear.
        systemPrompt: ctx.systemPrompt
          ? { type: 'preset' as const, preset: 'claude_code' as const, append: ctx.systemPrompt }
          : { type: 'preset' as const, preset: 'claude_code' as const },

        ...(ctx.maxTurns != null ? { maxTurns: ctx.maxTurns } : {}),
        ...(ctx.maxBudgetUsd != null ? { maxBudgetUsd: ctx.maxBudgetUsd } : {}),
        ...(isResume && resumeSessionId ? { resume: resumeSessionId } : {}),
      },
    });

    // Track the query for abort support
    let sessionId = resumeSessionId ?? '';

    try {
      for await (const message of result) {
        const events = translateMessage(message);

        for (const event of events) {
          // Track session ID from init events
          if (event.type === 'init') {
            sessionId = event.sessionId;
            this.activeAbortControllers.set(sessionId, abortController);
          }

          yield event;
        }
      }
    } catch (err: unknown) {
      // AbortError is expected when the caller calls abort() or cancels the signal.
      // Yield a structured abort event instead of propagating the exception so both
      // backends behave identically on abort (stdio yields this event; SDK throws).
      if (isAbortError(err)) {
        yield { type: 'error', message: 'aborted', subtype: 'abort' } as AgentEvent;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        yield { type: 'error', message: msg, subtype: 'api_error' } as AgentEvent;
      }
    } finally {
      if (sessionId) {
        this.activeAbortControllers.delete(sessionId);
      }
    }
  }
}

// ─── Message Translation ────────────────────────────────────────────────────

/**
 * Translate an SDK message into unified AgentEvents.
 * Returns an array because a single SDK message may contain multiple
 * content blocks (text + tool_use + thinking), each becoming a separate event.
 */
function translateMessage(message: SDKMessage): AgentEvent[] {
  switch (message.type) {
    case 'system':
      if (message.subtype === 'init') {
        return [{
          type: 'init',
          sessionId: message.session_id ?? '',
          model: message.model ?? '',
          tools: message.tools ?? [],
          mcpServers: message.mcp_servers?.map(s => ({
            name: s.name,
            status: s.status,
          })),
        }];
      }
      return [];

    case 'assistant':
      return translateAssistantMessage(message);

    case 'user':
      return translateUserMessage(message);

    case 'result':
      return [{
        type: 'result',
        subtype: mapResultSubtype(message.subtype, (message as Record<string, unknown>).is_error),
        durationMs: message.duration_ms,
        costUsd: message.total_cost_usd,
        numTurns: message.num_turns,
        sessionId: message.session_id ?? '',
      }];

    default:
      return [];
  }
}

/**
 * Translate SDK assistant messages (which contain content blocks)
 * into our unified event stream. An assistant message may contain
 * multiple content blocks (text, tool_use, thinking) — we yield ALL of them.
 *
 * SDK shape: { type: 'assistant', message: BetaMessage, ... }
 * Content blocks are in message.message.content, NOT message.content.
 */
function translateAssistantMessage(message: SDKMessage): AgentEvent[] {
  const msg = message as Record<string, unknown>;
  // The SDK wraps the Anthropic API message in a `message` field.
  const inner = msg.message as Record<string, unknown> | undefined;
  const content = inner?.content;
  if (!content || !Array.isArray(content)) {
    return [];
  }

  const events: AgentEvent[] = [];
  for (const block of content) {
    const event = translateContentBlock(block);
    if (event) {
      events.push(event);
    }
  }

  return events;
}

/**
 * Translate SDK user messages. These carry tool_result blocks that echo back
 * tool execution results — previously unreachable because translateMessage had
 * no 'user' case (Bug #1).
 */
function translateUserMessage(message: SDKMessage): AgentEvent[] {
  const msg = message as Record<string, unknown>;
  const inner = msg.message as Record<string, unknown> | undefined;
  const content = inner?.content;
  if (!content || !Array.isArray(content)) {
    return [];
  }

  const events: AgentEvent[] = [];
  for (const block of content) {
    const event = translateContentBlock(block);
    if (event) {
      events.push(event);
    }
  }

  return events;
}

function translateContentBlock(block: { type: string; [key: string]: unknown }): AgentEvent | null {
  switch (block.type) {
    case 'text': {
      const text = block.text;
      if (typeof text !== 'string') {
        console.warn('[claude-sdk] Unexpected text block format:', block);
        return null;
      }
      return { type: 'text', content: text };
    }

    case 'tool_use': {
      const { id, name, input } = block;
      if (typeof id !== 'string' || typeof name !== 'string') {
        console.warn('[claude-sdk] Unexpected tool_use block format:', block);
        return null;
      }
      return {
        type: 'tool_use',
        id,
        name,
        input: (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>,
      };
    }

    case 'tool_result': {
      const toolUseId = block.tool_use_id;
      if (typeof toolUseId !== 'string') {
        console.warn('[claude-sdk] Unexpected tool_result block format:', block);
        return null;
      }
      const content = typeof block.content === 'string'
        ? block.content
        : JSON.stringify(block.content ?? '');
      return {
        type: 'tool_result',
        toolUseId,
        content,
        isError: typeof block.is_error === 'boolean' ? block.is_error : undefined,
      };
    }

    case 'thinking': {
      const thinking = block.thinking;
      if (typeof thinking !== 'string') {
        console.warn('[claude-sdk] Unexpected thinking block format:', block);
        return null;
      }
      return { type: 'thinking', content: thinking };
    }

    default:
      return null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert unified MCPServerConfig[] to the SDK's mcpServers object format.
 */
function buildMcpServersConfig(
  configs: MCPServerConfig[],
): Record<string, {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}> {
  const result: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  }> = {};

  for (const config of configs) {
    if (config.transport.type === 'stdio') {
      result[config.name] = {
        command: config.transport.command,
        args: config.transport.args,
        env: config.transport.env,
      };
    } else if (config.transport.type === 'sse') {
      result[config.name] = {
        command: '', // SDK format placeholder
        url: config.transport.url,
        headers: config.transport.headers,
      };
    }
  }

  return result;
}

/**
 * Create an AbortController from an AbortSignal.
 * The SDK expects an AbortController, not a signal.
 */
function toAbortController(signal: AbortSignal): AbortController {
  const controller = new AbortController();

  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return controller;
}

/**
 * Map SDK result subtypes to our unified ResultEvent subtypes.
 * SDK returns 'success' for normal completion, we map to 'completed'.
 * SDK-specific error subtypes (like 'error_max_structured_output_retries')
 * are mapped to 'error_during_execution' to avoid silently masking errors.
 */
function mapResultSubtype(
  sdkSubtype: string,
  isError?: unknown,
): 'completed' | 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' {
  // is_error:true overrides the subtype — even 'success' means an API-level error
  if (isError === true) {
    return 'error_during_execution';
  }
  switch (sdkSubtype) {
    case 'success':
      return 'completed';
    case 'error_during_execution':
    case 'error_max_turns':
    case 'error_max_budget_usd':
      return sdkSubtype;
    case 'error_max_structured_output_retries':
      return 'error_during_execution';
    default:
      console.warn(`[claude-sdk] Unknown result subtype: "${sdkSubtype}", treating as error`);
      return 'error_during_execution';
  }
}

/**
 * Strip all internal Claude env keys from the subprocess environment.
 * Delegates to isInternalClaudeEnvKey so both backends use the same filter list.
 * This prevents CLAUDE_EFFORT (extended thinking), CLAUDECODE, CLAUDE_CODE_SESSION_ID,
 * etc. from leaking into the spawned agent's environment.
 */
function stripInternalEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).filter(([k]) => !isInternalClaudeEnvKey(k)),
  );
}

/**
 * Resolve permission mode for the SDK.
 * The SDK does not support 'ask' mode — it only accepts 'bypassPermissions' and 'auto'.
 * We log a warning when 'ask' is requested and fall back to 'bypassPermissions'.
 */
function resolvePermissionMode(
  mode: import('./types.js').PermissionMode | undefined,
): 'bypassPermissions' | 'auto' {
  if (mode === 'ask') {
    console.warn(
      '[claude-sdk] Permission mode "ask" is not supported by Claude SDK, falling back to "bypassPermissions"',
    );
    return 'bypassPermissions';
  }
  return mode ?? 'bypassPermissions';
}

/**
 * Factory function for creating ClaudeSdkBackend instances.
 * Accepts BackendConfig for interface compatibility (config is unused for this backend).
 */
export function createClaudeSdkBackend(_config?: import('./types.js').BackendConfig): ClaudeSdkBackend {
  return new ClaudeSdkBackend();
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    // Node/browser AbortError name, or DOMException abort code
    return err.name === 'AbortError' || (err as NodeJS.ErrnoException).code === 'ABORT_ERR';
  }
  return false;
}
