/**
 * Backends module — pluggable LLM backend abstraction.
 *
 * Re-exports all types from types.ts for convenient importing.
 */

export type {
  // Core
  AgentBackend,
  AgentRunContext,
  AgentEvent,

  // Events
  InitEvent,
  TextEvent,
  ThinkingEvent,
  ToolUseEvent,
  ToolResultEvent,
  ResultEvent,
  ErrorEvent,
  SystemEvent,

  // Tool system
  ToolDefinition,
  ToolExecutor,
  ToolResult,
  ContentBlock,

  // Permission
  PermissionMode,

  // MCP
  MCPServerConfig,
  MCPTransportConfig,
  MCPStdioTransport,
  MCPSSETransport,

  // Config
  BackendType,
  BackendConfig,
  BackendFactory,

  // Schema
  JsonSchema,
  JsonSchemaProperty,
} from './types.js';
