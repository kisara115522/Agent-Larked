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
