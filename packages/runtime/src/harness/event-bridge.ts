/**
 * Event Bridge — translates AgentEvent stream to Flock platform activity.
 *
 * Consumes the unified event stream from any AgentBackend and:
 *  1. Reports agent activity to the Flock server
 *  2. Tracks session state (status, cost, turns)
 *  3. Provides a summary of the session when it ends
 *
 * Inspired by how agent-runner.ts currently handles SDK messages,
 * but generalized to work with any backend's event stream.
 */

import type {
  AgentEvent,
  InitEvent,
  ResultEvent,
  ErrorEvent,
} from '../backends/types.js';

export type ActivityReporter = (
  agentId: string,
  activityType: string,
  detail: string,
  metadata?: Record<string, unknown>,
  agentToken?: string,
) => Promise<void>;

export interface SessionState {
  sessionId: string | null;
  model: string | null;
  status: 'initializing' | 'active' | 'completed' | 'error' | 'aborted';
  tools: string[];
  turnCount: number;
  totalTextLength: number;
  toolCallCount: number;
  startTime: number;
  endTime: number | null;
  costUsd: number | null;
  error: string | null;
}

/**
 * Create a new session state tracker.
 */
export function createSessionState(): SessionState {
  return {
    sessionId: null,
    model: null,
    status: 'initializing',
    tools: [],
    turnCount: 0,
    totalTextLength: 0,
    toolCallCount: 0,
    startTime: Date.now(),
    endTime: null,
    costUsd: null,
    error: null,
  };
}

/**
 * Process a single AgentEvent, updating session state and reporting activity.
 */
export async function processEvent(
  event: AgentEvent,
  state: SessionState,
  agentId: string,
  reportActivity: ActivityReporter,
  agentToken?: string,
): Promise<SessionState> {
  switch (event.type) {
    case 'init':
      return handleInit(event, state, agentId, reportActivity, agentToken);

    case 'text':
      reportActivity(agentId, 'message', event.content.slice(0, 2000), {}, agentToken).catch(() => {});
      return {
        ...state,
        totalTextLength: state.totalTextLength + event.content.length,
      };

    case 'thinking':
      reportActivity(agentId, 'think', event.content.slice(0, 500), {}, agentToken).catch(() => {});
      return state;

    case 'tool_use':
      reportActivity(
        agentId,
        'tool_call',
        event.name,
        { tool_id: event.id, input: event.input },
        agentToken,
      ).catch(() => {});
      return {
        ...state,
        toolCallCount: state.toolCallCount + 1,
      };

    case 'tool_result':
      reportActivity(
        agentId,
        'tool_result',
        event.content.slice(0, 500),
        { tool_use_id: event.toolUseId, is_error: event.isError },
        agentToken,
      ).catch(() => {});
      return state;

    case 'result':
      return handleResult(event, state, agentId, reportActivity, agentToken);

    case 'error':
      return handleError(event, state, agentId, reportActivity, agentToken);

    case 'system':
      // System events are pass-through; log for debugging
      return state;

    default:
      return state;
  }
}

// ─── Event Handlers ─────────────────────────────────────────────────────────

async function handleInit(
  event: InitEvent,
  state: SessionState,
  agentId: string,
  reportActivity: ActivityReporter,
  agentToken?: string,
): Promise<SessionState> {
  const newState: SessionState = {
    ...state,
    sessionId: event.sessionId,
    model: event.model,
    tools: event.tools,
    status: 'active',
  };

  await reportActivity(
    agentId,
    'status_change',
    'Agent active',
    {
      session_id: event.sessionId,
      session_source: 'agent-harness',
      model: event.model,
      tools: event.tools.length,
      mcp_servers: event.mcpServers?.map(s => `${s.name}:${s.status}`).join(', ') ?? '',
    },
    agentToken,
  ).catch((err) => {
    console.error(`[event-bridge] Failed to report init for ${agentId}:`, err);
  });

  return newState;
}

async function handleResult(
  event: ResultEvent,
  state: SessionState,
  agentId: string,
  reportActivity: ActivityReporter,
  agentToken?: string,
): Promise<SessionState> {
  const isError = event.subtype !== 'completed';
  const newState: SessionState = {
    ...state,
    status: isError ? 'error' : 'completed',
    endTime: Date.now(),
    costUsd: event.costUsd ?? null,
    turnCount: event.numTurns ?? state.turnCount,
    sessionId: event.sessionId,
  };

  await reportActivity(
    agentId,
    isError ? 'error' : 'status_change',
    isError ? `Agent error: ${event.subtype}` : 'Agent dormant (completed)',
    {
      session_id: event.sessionId,
      duration_ms: event.durationMs,
      cost_usd: event.costUsd,
      num_turns: event.numTurns,
      text_length: state.totalTextLength,
      tool_calls: state.toolCallCount,
    },
    agentToken,
  ).catch((err) => {
    console.error(`[event-bridge] Failed to report result for ${agentId}:`, err);
  });

  return newState;
}

async function handleError(
  event: ErrorEvent,
  state: SessionState,
  agentId: string,
  reportActivity: ActivityReporter,
  agentToken?: string,
): Promise<SessionState> {
  const newState: SessionState = {
    ...state,
    status: event.subtype === 'abort' ? 'aborted' : 'error',
    endTime: Date.now(),
    error: event.message,
  };

  // Don't report abort as an error — it's an expected lifecycle event
  if (event.subtype !== 'abort') {
    await reportActivity(
      agentId,
      'error',
      `Agent error (${event.subtype}): ${event.message}`,
      {
        session_id: state.sessionId,
        error_subtype: event.subtype,
      },
      agentToken,
    ).catch((err) => {
      console.error(`[event-bridge] Failed to report error for ${agentId}:`, err);
    });
  }

  return newState;
}
