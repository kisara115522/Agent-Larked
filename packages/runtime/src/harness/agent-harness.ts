/**
 * AgentHarness — the core orchestration layer for agent sessions.
 *
 * Sits between AgentRunner (lifecycle management) and AgentBackend (LLM execution).
 *
 * Responsibilities:
 *  1. Backend selection — resolve BackendConfig to an AgentBackend instance
 *  2. Context assembly — compose system prompt, build AgentRunContext
 *  3. Session execution — drive the backend's event stream
 *  4. Event bridging — translate AgentEvents to Flock activity reports
 *  5. Lifecycle management — abort, resume, session tracking
 *
 * Architecture:
 *  AgentRunner → AgentHarness → AgentBackend
 *                   ↓
 *            PromptComposer + EventBridge + BackendRegistry
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentBackend,
  AgentRunContext,
  AgentEvent,
  BackendConfig,
  ToolDefinition,
  ToolExecutor,
  ToolResult,
  MCPServerConfig,
} from '../backends/types.js';
import { BackendRegistry, defaultBackendRegistry } from './backend-registry.js';
import { composeSystemPrompt, type ComposeOptions, type AgentIdentity, type RoomContext } from './prompt-composer.js';
import {
  processEvent,
  createSessionState,
  type ActivityReporter,
  type SessionState,
} from './event-bridge.js';

// ─── Public Types ───────────────────────────────────────────────────────────

export interface HarnessConfig {
  /** Flock server URL for activity reporting */
  flockServerUrl: string;
  /** Working directory for agent sessions */
  cwd: string;
  /** Path to the MCP server binary */
  mcpServerPath: string;
  /** Database path for MCP server */
  dbPath: string;
  /** Default base system prompt (overrides the generic default) */
  defaultBasePrompt?: string;
  /** Backend registry (defaults to the global registry) */
  backendRegistry?: BackendRegistry;
  /** Activity reporter function */
  reportActivity: ActivityReporter;
}

export interface SpawnRequest {
  /** Agent ID in the Flock platform */
  agentId: string;
  /** Agent display name */
  agentName: string;
  /** The prompt/message to start the agent with */
  prompt: string;
  /** Agent token for Flock API authentication */
  agentToken?: string;
  /** Backend configuration (defaults to claude-sdk) */
  backendConfig?: BackendConfig;
  /** Model override */
  model?: string;
  /** Session ID for resume */
  sessionId?: string;
  /** System prompt override */
  systemPrompt?: string;
  /** Tool definitions for backends that manage their own tool loop */
  tools?: ToolDefinition[];
  /** Room context for prompt composition */
  room?: RoomContext;
  /** Maximum turns */
  maxTurns?: number;
  /** Maximum budget in USD */
  maxBudgetUsd?: number;
  /** Environment variables */
  env?: Record<string, string>;
  /** MCP server configurations (additional to built-in flock server) */
  extraMcpServers?: MCPServerConfig[];
}

export interface HarnessSession {
  sessionId: string;
  agentId: string;
  backend: AgentBackend;
  backendName: string;
  state: SessionState;
  abortController: AbortController;
  promise: Promise<SessionState>;
}

// ─── AgentHarness ───────────────────────────────────────────────────────────

export class AgentHarness {
  private config: HarnessConfig;
  private registry: BackendRegistry;
  private sessions = new Map<string, HarnessSession>();

  constructor(config: HarnessConfig) {
    this.config = config;
    this.registry = config.backendRegistry ?? defaultBackendRegistry;
  }

  /**
   * Spawn a new agent session.
   *
   * 1. Resolves the backend from config
   * 2. Composes the system prompt
   * 3. Builds the AgentRunContext
   * 4. Starts the backend and consumes its event stream
   * 5. Returns a HarnessSession for lifecycle management
   */
  async spawn(request: SpawnRequest): Promise<HarnessSession> {
    // Check if already running (including initializing to prevent race condition)
    const existing = this.sessions.get(request.agentId);
    if (existing && (existing.state.status === 'active' || existing.state.status === 'initializing')) {
      console.log(`[harness] Agent ${request.agentId} already ${existing.state.status} (session ${existing.sessionId})`);
      return existing;
    }

    // Resolve backend
    const backendConfig: BackendConfig = request.backendConfig ?? { type: 'claude-stdio' };
    const backend = this.registry.get(backendConfig);

    // Generate session ID
    const sessionId = request.sessionId ?? randomUUID();

    // Compose system prompt
    const identity: AgentIdentity = {
      agentId: request.agentId,
      agentName: request.agentName,
    };
    const promptOptions: ComposeOptions = {
      identity,
      room: request.room,
      customBasePrompt: this.config.defaultBasePrompt,
      appendPrompt: request.systemPrompt,
      cwd: this.config.cwd,
    };
    const { systemPrompt } = composeSystemPrompt(promptOptions);

    // Build MCP servers
    const mcpServers = this.buildMcpServers(request);

    // Build run context
    const abortController = new AbortController();
    const ctx: AgentRunContext = {
      prompt: request.prompt,
      model: request.model,
      // Tool definitions for backends that manage their own tool loop (e.g. OpenAICompatBackend).
      // ClaudeSdkBackend ignores this — tools come from MCP + allowedTools.
      // TODO: populate from MCP server tool discovery when available.
      tools: request.tools ?? [],
      toolExecutor: this.createToolExecutor(request),
      mcpServers,
      systemPrompt,
      cwd: this.config.cwd,
      signal: abortController.signal,
      sessionId: request.sessionId,
      maxTurns: request.maxTurns,
      maxBudgetUsd: request.maxBudgetUsd,
      permissionMode: 'bypassPermissions',
      env: request.env,
      agentName: request.agentName,
      agentId: request.agentId,
      agentToken: request.agentToken,
    };

    // Create session state
    const sessionState = createSessionState();

    console.log(`[harness] Spawning agent ${request.agentId} with backend=${backend.name}, session=${sessionId}`);

    // Start the event consumption loop (async)
    const promise = this.runSession(backend, ctx, request.agentId, sessionState, request.agentToken, sessionId);

    const session: HarnessSession = {
      sessionId,
      agentId: request.agentId,
      backend,
      backendName: backend.name,
      state: sessionState,
      abortController,
      promise,
    };

    this.sessions.set(request.agentId, session);

    return session;
  }

  /**
   * Abort a running session.
   */
  abort(agentId: string): boolean {
    const session = this.sessions.get(agentId);
    if (!session) return false;

    console.log(`[harness] Aborting agent ${agentId} (session ${session.sessionId})`);
    // Abort the external signal
    session.abortController.abort();
    // Also directly call backend.abort() for clean shutdown
    // (e.g. ClaudeSdkBackend needs to call q.abort() on the SDK Query)
    try {
      session.backend.abort(session.sessionId);
    } catch (err) {
      console.warn(`[harness] backend.abort() failed for ${agentId}:`, err);
    }
    return true;
  }

  /**
   * Get the current state of a session.
   */
  getState(agentId: string): SessionState | undefined {
    return this.sessions.get(agentId)?.state;
  }

  /**
   * Get all active sessions.
   */
  getActiveSessions(): HarnessSession[] {
    return Array.from(this.sessions.values()).filter(
      s => s.state.status === 'active' || s.state.status === 'initializing',
    );
  }

  /**
   * Remove a completed/errored session from tracking.
   */
  removeSession(agentId: string): boolean {
    return this.sessions.delete(agentId);
  }

  /**
   * Shut down all active sessions.
   */
  async shutdown(): Promise<void> {
    console.log(`[harness] Shutting down ${this.sessions.size} sessions...`);
    for (const [agentId, session] of this.sessions) {
      session.abortController.abort();
      // Also call backend.abort() for clean internal shutdown
      try {
        session.backend.abort(session.sessionId);
      } catch (err) {
        console.warn(`[harness] backend.abort() failed during shutdown for ${agentId}:`, err);
      }
    }
    // Wait for all sessions to finish
    const promises = Array.from(this.sessions.values()).map(s =>
      s.promise.catch(() => {}) // swallow errors during shutdown
    );
    await Promise.all(promises);
    this.sessions.clear();
  }

  // ─── Private ────────────────────────────────────────────────────────────

  /**
   * Run a session: consume the backend's event stream and bridge to Flock.
   */
  private async runSession(
    backend: AgentBackend,
    ctx: AgentRunContext,
    agentId: string,
    state: SessionState,
    agentToken: string | undefined,
    sessionId: string,
  ): Promise<SessionState> {
    let currentState = state;

    try {
      const eventStream = ctx.sessionId && backend.resume
        ? backend.resume(ctx.sessionId, ctx)
        : backend.run(ctx);

      for await (const event of eventStream) {
        currentState = await processEvent(
          event,
          currentState,
          agentId,
          this.config.reportActivity,
          agentToken,
        );

        // Update the session's state reference (and sync real SDK sessionId for abort)
        const session = this.sessions.get(agentId);
        if (session) {
          session.state = currentState;
          if (event.type === 'init' && event.sessionId) {
            session.sessionId = event.sessionId;
          }
        }

        // Check for abort
        if (ctx.signal.aborted) {
          break;
        }
      }
    } catch (err) {
      if (ctx.signal.aborted) {
        currentState = {
          ...currentState,
          status: 'aborted',
          endTime: Date.now(),
        };
      } else {
        console.error(`[harness] Session ${sessionId} error:`, err);
        currentState = {
          ...currentState,
          status: 'error',
          endTime: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        };

        // Report the error
        await this.config.reportActivity(
          agentId,
          'error',
          `Harness error: ${currentState.error}`,
          { session_id: sessionId },
          agentToken,
        ).catch(() => {});
      }
    }

    // Final state update
    if (currentState.status === 'active' || currentState.status === 'initializing') {
      currentState = { ...currentState, status: 'completed', endTime: Date.now() };
    }

    console.log(
      `[harness] Session ${sessionId} ended: status=${currentState.status}, ` +
      `turns=${currentState.turnCount}, tools=${currentState.toolCallCount}, ` +
      `text=${currentState.totalTextLength} chars`,
    );

    // Cleanup: remove completed/errored sessions to prevent memory leak.
    // Active sessions are kept for abort/dedup support.
    if (currentState.status !== 'active' && currentState.status !== 'initializing') {
      this.sessions.delete(agentId);
    }

    return currentState;
  }

  /**
   * Build MCP server configs for a spawn request.
   * Always includes the built-in Flock MCP server.
   */
  private buildMcpServers(request: SpawnRequest): MCPServerConfig[] {
    const servers: MCPServerConfig[] = [
      {
        name: 'flock',
        transport: {
          type: 'stdio',
          command: 'node',
          args: [this.config.mcpServerPath],
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
            ),
            DB_PATH: this.config.dbPath,
            AGENT_NAME: request.agentName,
            ...(request.agentToken ? { AGENT_TOKEN: request.agentToken } : {}),
          },
        },
      },
    ];

    if (request.extraMcpServers) {
      servers.push(...request.extraMcpServers);
    }

    return servers;
  }

  /**
   * Create a tool executor that delegates to the appropriate tool implementation.
   *
   * Currently provides a basic executor for tools the OpenAICompatBackend needs.
   * The ClaudeSdkBackend ignores this entirely (SDK manages tools internally).
   */
  private createToolExecutor(request: SpawnRequest): ToolExecutor {
    // The tool executor is used by OpenAICompatBackend's agentic loop.
    // ClaudeSdkBackend ignores it (SDK manages tools internally via MCP).
    //
    // For OpenAICompatBackend, built-in Flock tools should be resolved via
    // the MCP server (same as ClaudeSdkBackend). Custom tools can be
    // registered here when Task 4-B is complete.
    //
    // Currently throws — this is intentional. If OpenAICompatBackend calls
    // this without proper tool registration, it should fail loudly rather
    // than silently return garbage.
    return async (name: string, input: Record<string, unknown>): Promise<ToolResult> => {
      console.error(
        `[harness] Unregistered tool called: ${name} ` +
        `(input: ${JSON.stringify(input).slice(0, 100)}). ` +
        `OpenAICompatBackend requires toolExecutor to be populated. ` +
        `Flock tools are available via MCP, but direct tool calls need implementation.`,
      );
      throw new Error(
        `Tool "${name}" not implemented in harness executor. ` +
        `Register tools via BackendRegistry or use ClaudeSdkBackend (which uses MCP).`,
      );
    };
  }
}
