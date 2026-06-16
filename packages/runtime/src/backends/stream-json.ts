/**
 * Claude CLI stream-json protocol: wire types, input frame builder, and the
 * translator from raw stream-json messages to the unified AgentEvent stream.
 *
 * Wire format empirically verified against claude CLI 2.1.178
 * (docs/plans/2026-06-16-stdio-backend-migration.md §3).
 */
import type { AgentEvent } from './types.js';

// ─── Wire types (only the fields we read) ────────────────────────────────────

export interface StreamJsonContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

export interface StreamJsonInnerMessage {
  role?: string;
  model?: string;
  content?: StreamJsonContentBlock[];
}

export interface StreamJsonMessage {
  type: string;                       // system | assistant | user | result | control_request | ...
  subtype?: string;                   // init | success | ...
  session_id?: string;
  model?: string;
  tools?: string[];
  mcp_servers?: Array<{ name: string; status: string }>;
  message?: StreamJsonInnerMessage;   // assistant/user wrap the API message here
  // result fields
  is_error?: boolean;
  result?: string;
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  // control_request fields
  request_id?: string;
  request?: { subtype?: string; tool_name?: string; input?: unknown };
}

// ─── Input frame ──────────────────────────────────────────────────────────────

/** Build a single stream-json user-input line (newline-terminated). */
export function buildUserInput(prompt: string): string {
  const frame = {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: prompt }] },
  };
  return JSON.stringify(frame) + '\n';
}

/** Build a control_response line approving a tool use (newline-terminated). */
export function buildControlAllow(requestId: string, input: unknown): string {
  const frame = {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: {
        behavior: 'allow',
        updatedInput: (input && typeof input === 'object') ? input : {},
      },
    },
  };
  return JSON.stringify(frame) + '\n';
}

// ─── Translation ─────────────────────────────────────────────────────────────

/** Map a result message to a ResultEvent subtype, honoring is_error. */
export function mapResultSubtype(
  msg: StreamJsonMessage,
): 'completed' | 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' {
  // CRITICAL: subtype "success" can co-occur with is_error:true (e.g. API 400).
  if (msg.is_error) return 'error_during_execution';
  switch (msg.subtype) {
    case 'success':
      return 'completed';
    case 'error_max_turns':
      return 'error_max_turns';
    case 'error_max_budget_usd':
      return 'error_max_budget_usd';
    default:
      return 'completed';
  }
}

export function translateContentBlock(block: StreamJsonContentBlock): AgentEvent | null {
  switch (block.type) {
    case 'text':
      return typeof block.text === 'string' ? { type: 'text', content: block.text } : null;
    case 'thinking':
      return typeof block.thinking === 'string' ? { type: 'thinking', content: block.thinking } : null;
    case 'tool_use':
      if (typeof block.id !== 'string' || typeof block.name !== 'string') return null;
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: (block.input && typeof block.input === 'object' ? block.input : {}) as Record<string, unknown>,
      };
    case 'tool_result':
      if (typeof block.tool_use_id !== 'string') return null;
      return {
        type: 'tool_result',
        toolUseId: block.tool_use_id,
        content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''),
        isError: typeof block.is_error === 'boolean' ? block.is_error : undefined,
      };
    default:
      return null;
  }
}
