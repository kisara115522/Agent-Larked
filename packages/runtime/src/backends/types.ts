/**
 * Backend abstraction layer for the Agent Runtime.
 *
 * This module defines the core interfaces that allow multiple LLM backends
 * (Claude SDK, OpenAI-compatible, etc.) to plug into the agent harness.
 *
 * Design goals:
 *  - Unified event stream regardless of backend
 *  - Pluggable tool execution (SDK-managed vs harness-managed)
 *  - Session management for resume/pause
 *  - Clean separation of concerns
 */

// ─── Core Backend Interface ─────────────────────────────────────────────────

/**
 * An AgentBackend is a pluggable LLM backend that runs an agentic loop.
 *
 * Implementations:
 *  - ClaudeSdkBackend: wraps the existing @anthropic-ai/claude-agent-sdk query()
 *  - OpenAICompatBackend: self-managed tool loop for OpenAI-compatible APIs
 */
export interface AgentBackend {
  /** Unique name identifying this backend (e.g. 'claude-sdk', 'openai-compat') */
  readonly name: string;

  /**
   * Run an agent session. Returns an async iterable of events that the
   * harness consumes to update state, report to the platform, etc.
   *
   * The backend is responsible for its own agentic loop:
   *  - ClaudeSdkBackend: delegates entirely to SDK (tool loop is internal)
   *  - OpenAICompatBackend: implements prompt → LLM → tool_use → execute → loop
   */
  run(ctx: AgentRunContext): AsyncIterable<AgentEvent>;

  /**
   * Abort a running session. Best-effort — the backend should stop as soon
   * as possible after this is called.
   */
  abort(sessionId: string): void;

  /**
   * Optional: resume a previous session. Returns true if the backend supports
   * resume and the session was found, false otherwise.
   */
  resume?(sessionId: string, ctx: AgentRunContext): AsyncIterable<AgentEvent>;
}

// ─── Run Context ────────────────────────────────────────────────────────────

/**
 * Context passed to AgentBackend.run(). Contains everything the backend
 * needs to execute an agent session.
 */
export interface AgentRunContext {
  /** The user/system prompt to start the conversation */
  prompt: string;

  /** Model identifier (e.g. 'claude-sonnet-4-20250514', 'deepseek-chat') */
  model?: string;

  /**
   * Tool definitions available to the LLM.
   *  - ClaudeSdkBackend: ignores this (tools are managed via allowedTools + MCP)
   *  - OpenAICompatBackend: sends these to the LLM and uses toolExecutor to run them
   */
  tools: ToolDefinition[];

  /**
   * Callback to execute a tool. The harness provides this; the backend calls it
   * when the LLM requests a tool_use.
   *
   *  - ClaudeSdkBackend: does not use this (SDK manages tool execution internally)
   *  - OpenAICompatBackend: calls this for every tool_use in the loop
   */
  toolExecutor: ToolExecutor;

  /**
   * MCP server configurations.
   *  - ClaudeSdkBackend: passes these directly to the SDK
   *  - OpenAICompatBackend: may connect to these for additional tools
   */
  mcpServers: MCPServerConfig[];

  /**
   * Allowed tool names for the SDK backend (maps to SDK's allowedTools).
   * For OpenAICompatBackend this is informational only.
   */
  allowedTools?: string[];

  /** System prompt to prepend */
  systemPrompt?: string;

  /** Working directory for the agent session */
  cwd: string;

  /** Abort signal for cancellation */
  signal: AbortSignal;

  /**
   * Session ID for resume. If provided, the backend should attempt to
   * continue a previous conversation.
   */
  sessionId?: string;

  /** Maximum number of turns before the loop stops (safety limit) */
  maxTurns?: number;

  /** Maximum budget in USD before the loop stops */
  maxBudgetUsd?: number;

  /** Permission mode: how the backend handles tool permission requests */
  permissionMode?: PermissionMode;

  /** Agent-specific environment variables (merged with process.env) */
  env?: Record<string, string>;

  /** Agent name for display / logging */
  agentName?: string;

  /** Agent ID in the platform */
  agentId?: string;

  /** Agent token for authenticating with the platform */
  agentToken?: string;
}

// ─── Permission ─────────────────────────────────────────────────────────────

/**
 * Permission mode controls how the backend handles tool permission requests.
 *
 *  - 'bypassPermissions': auto-approve all tools (current behavior for SDK)
 *  - 'auto': backend decides (approve safe tools, prompt for dangerous ones)
 *  - 'ask': always prompt for permission
 */
export type PermissionMode = 'bypassPermissions' | 'auto' | 'ask';

// ─── Tool System ────────────────────────────────────────────────────────────

/**
 * A tool definition that gets sent to the LLM.
 * Follows the JSON Schema / Anthropic tool_use format.
 */
export interface ToolDefinition {
  /** Tool name (unique within a session) */
  name: string;

  /** Human-readable description for the LLM */
  description: string;

  /** JSON Schema for the tool's input parameters */
  inputSchema: JsonSchema;
}

/**
 * Execute a tool and return the result.
 * This is provided by the harness; the backend calls it during the tool loop.
 */
export type ToolExecutor = (
  name: string,
  input: Record<string, unknown>,
) => Promise<ToolResult>;

/**
 * Result returned by a tool execution.
 */
export interface ToolResult {
  /** Text content to return to the LLM */
  content: string;

  /** Whether this result represents an error */
  isError?: boolean;

  /**
   * Optional: structured content for rich display (images, etc.)
   * Each block follows the Anthropic content block format.
   */
  contentBlocks?: ContentBlock[];
}

/** A content block — text or base64-encoded image */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

// ─── Event Stream ───────────────────────────────────────────────────────────

/**
 * Unified event stream from a backend. All backends emit these events
 * regardless of their internal implementation.
 *
 * The harness (agent-runner.ts) consumes these to:
 *  - Update platform state (activity reports)
 *  - Stream output to the UI
 *  - Track sessions, costs, etc.
 */
export type AgentEvent =
  /** Backend has started, session is initialized */
  | InitEvent
  /** Streaming text from the LLM */
  | TextEvent
  /** Extended thinking / reasoning content */
  | ThinkingEvent
  /** LLM wants to call a tool */
  | ToolUseEvent
  /** Tool execution result */
  | ToolResultEvent
  /** Agent session completed */
  | ResultEvent
  /** An error occurred */
  | ErrorEvent
  /** Internal system event (for platform integration) */
  | SystemEvent;

export interface InitEvent {
  type: 'init';
  /** Session ID assigned by the backend */
  sessionId: string;
  /** Model being used */
  model: string;
  /** Tool names available in this session */
  tools: string[];
  /** MCP server status */
  mcpServers?: Array<{ name: string; status: string }>;
}

export interface TextEvent {
  type: 'text';
  /** Text content chunk (streaming) */
  content: string;
}

export interface ThinkingEvent {
  type: 'thinking';
  /** Extended thinking content */
  content: string;
}

export interface ToolUseEvent {
  type: 'tool_use';
  /** Unique ID for this tool call (matches with ToolResultEvent) */
  id: string;
  /** Tool name */
  name: string;
  /** Tool input arguments */
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: 'tool_result';
  /** ID of the tool_use this is responding to */
  toolUseId: string;
  /** Text result content */
  content: string;
  /** Whether the tool execution errored */
  isError?: boolean;
}

export interface ResultEvent {
  type: 'result';
  /**
   * Result subtype:
   *  - 'completed': agent finished normally
   *  - 'error_during_execution': error in tool execution
   *  - 'error_max_turns': hit max turns limit
   *  - 'error_max_budget_usd': hit budget limit
   */
  subtype: 'completed' | 'success' | 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries';
  /** Duration in milliseconds */
  durationMs: number;
  /** Total cost in USD (if available) */
  costUsd?: number;
  /** Number of conversation turns */
  numTurns?: number;
  /** Final session ID */
  sessionId: string;
}

export interface ErrorEvent {
  type: 'error';
  /** Error message */
  message: string;
  /**
   * Error subtype:
   *  - 'api_error': LLM API call failed
   *  - 'tool_error': tool execution failed
   *  - 'auth_error': authentication/authorization failed
   *  - 'abort': session was aborted
   *  - 'unknown': unspecified error
   */
  subtype: 'api_error' | 'tool_error' | 'auth_error' | 'abort' | 'unknown';
}

export interface SystemEvent {
  type: 'system';
  /** System event subtype */
  subtype: string;
  /** Arbitrary metadata */
  data?: Record<string, unknown>;
}

// ─── MCP Server Config ──────────────────────────────────────────────────────

/**
 * Configuration for an MCP (Model Context Protocol) server.
 * Compatible with the Claude SDK's mcpServers format.
 */
export interface MCPServerConfig {
  /** Server name (used as key in mcpServers map) */
  name: string;

  /** Transport type */
  transport: MCPTransportConfig;
}

export type MCPTransportConfig =
  | MCPStdioTransport
  | MCPSSETransport;

export interface MCPStdioTransport {
  type: 'stdio';
  /** Command to spawn the server process */
  command: string;
  /** Arguments for the command */
  args?: string[];
  /** Environment variables for the server process */
  env?: Record<string, string>;
}

export interface MCPSSETransport {
  type: 'sse';
  /** Server URL for SSE connection */
  url: string;
  /** Optional headers for the connection */
  headers?: Record<string, string>;
}

// ─── Backend Configuration ──────────────────────────────────────────────────

/**
 * Backend type identifier.
 *  - 'claude-sdk': uses the existing Claude Agent SDK
 *  - 'openai-compat': uses OpenAI-compatible API (DeepSeek, Ollama, etc.)
 */
export type BackendType = 'claude-sdk' | 'claude-stdio' | 'openai-compat';

/**
 * Configuration for backend selection and initialization.
 * Can be set per-agent or globally via environment variables.
 */
export interface BackendConfig {
  /** Which backend to use */
  type: BackendType;

  /** Model to use (overrides agent-level model) */
  model?: string;

  /**
   * For openai-compat backend: the API endpoint URL.
   * Examples: 'https://api.openai.com/v1', 'http://localhost:11434/v1'
   */
  apiEndpoint?: string;

  /**
   * For openai-compat backend: the API key.
   * For openai-compat backend: stored securely, never logged.
   */
  apiKey?: string;

  /**
   * For openai-compat backend: additional headers to send with API requests.
   */
  apiHeaders?: Record<string, string>;

  /**
   * For openai-compat backend: request timeout in milliseconds.
   */
  timeoutMs?: number;

  /**
   * For openai-compat backend: max retry attempts on transient errors.
   */
  maxRetries?: number;
}

// ─── JSON Schema (minimal) ──────────────────────────────────────────────────

/**
 * Minimal JSON Schema type for tool input definitions.
 * Only covers the subset we need; not a full JSON Schema implementation.
 */
export interface JsonSchema {
  type: 'object';
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  /** Description of the schema (for the LLM) */
  description?: string;
  additionalProperties?: boolean;
}

export type JsonSchemaProperty =
  | { type: 'string'; description?: string; enum?: string[] }
  | { type: 'number' | 'integer'; description?: string }
  | { type: 'boolean'; description?: string }
  | { type: 'array'; items: JsonSchemaProperty; description?: string }
  | { type: 'object'; properties?: Record<string, JsonSchemaProperty>; description?: string };

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Factory function type for creating backend instances.
 * Each backend module exports a create function matching this signature.
 */
export type BackendFactory = (config: BackendConfig) => AgentBackend;
