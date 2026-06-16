/**
 * Agent activity types for the activity timeline feature.
 *
 * Activities flow via the workflow_event SSE event and can be backfilled
 * via GET /agents/:id/activity. Each activity represents a single step
 * in an agent's reasoning or tool-use chain.
 */

export type ActivityType =
  | 'message'
  | 'think'
  | 'tool_call'
  | 'tool_result'
  | 'status_change'
  | 'error';

export interface AgentActivity {
  id: string;
  agent_id: string;
  activity_type: ActivityType;
  detail: string;
  metadata: ActivityMetadata;
  created_at: string;
}

/** Metadata varies by activity_type */
export interface ActivityMetadata {
  tool_id?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  session_id?: string;
  session_source?: string;
  model?: string;
  tools?: number;
  mcp_servers?: string;
  [key: string]: unknown;
}

/** Parsed from the workflow_event SSE payload */
export interface WorkflowEventPayload {
  id?: string;
  agent_id: string;
  activity_type: ActivityType;
  detail: string;
  metadata: ActivityMetadata;
  created_at: string;
}
