/**
 * OpenAI-Compatible Backend
 *
 * Implements the AgentBackend interface for any LLM that supports the
 * OpenAI Chat Completions API format, including:
 *  - OpenAI API
 *  - DeepSeek
 *  - Ollama (local)
 *  - vLLM, LM Studio
 *  - Any OpenAI-compatible endpoint
 *
 * Unlike ClaudeSdkBackend, this backend manages its own agentic loop:
 *   prompt → LLM → tool_use → execute → tool_result → loop
 *
 * Design reference: Claude Code's queryLoop() in src/query.ts
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentBackend,
  AgentRunContext,
  AgentEvent,
  ToolDefinition,
  BackendConfig,
  JsonSchema,
} from './types.js';

// ─── Internal Types ─────────────────────────────────────────────────────────

/** Result of a single streaming turn */
interface StreamTurnResult {
  textContent: string;
  toolCalls?: OpenAIToolCall[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ─── OpenAI API Types (minimal) ─────────────────────────────────────────────

/** OpenAI Chat Completion message role */
type OpenAIRole = 'system' | 'user' | 'assistant' | 'tool';

/** OpenAI function calling tool definition */
interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

/** OpenAI chat message */
interface OpenAIMessage {
  role: OpenAIRole;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

/** OpenAI tool call in assistant response */
interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** OpenAI streaming chunk */
interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ─── Configuration ──────────────────────────────────────────────────────────

/** Default settings */
const DEFAULT_MAX_TURNS = 100;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MODEL = 'gpt-4o';
const RETRY_BASE_DELAY_MS = 1_000;

// ─── Main Class ─────────────────────────────────────────────────────────────

export class OpenAICompatBackend implements AgentBackend {
  readonly name = 'openai-compat';

  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly defaultModel: string;

  /** Map of sessionId → AbortController for cancellation */
  private abortControllers = new Map<string, AbortController>();

  constructor(config: BackendConfig) {
    this.endpoint = config.apiEndpoint ?? 'https://api.openai.com/v1';
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.headers = { ...config.apiHeaders };
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.defaultModel = config.model ?? DEFAULT_MODEL;
  }

  // ─── AgentBackend interface ────────────────────────────────────────────

  abort(sessionId: string): void {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionId);
    }
  }

  /**
   * Run the agentic loop for a session.
   *
   * This is an async generator that yields AgentEvents as the loop progresses.
   * The loop: prompt → LLM → tool_use → execute → tool_result → loop
   */
  async *run(ctx: AgentRunContext): AsyncIterable<AgentEvent> {
    const sessionId = ctx.sessionId ?? generateSessionId();
    const model = ctx.model ?? this.defaultModel;
    const maxTurns = ctx.maxTurns ?? DEFAULT_MAX_TURNS;

    // Create an AbortController that combines ctx.signal with our own
    const sessionAbort = new AbortController();
    this.abortControllers.set(sessionId, sessionAbort);

    // Link external signal to our controller.
    // { once: true } ensures the listener self-removes after firing.
    // The finally block below handles cleanup if the signal never fires.
    const onExternalAbort = () => sessionAbort.abort();
    if (ctx.signal.aborted) {
      sessionAbort.abort();
    } else {
      ctx.signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    const startTime = Date.now();
    let totalCost = 0;
    let turnCount = 0;

    // Yield init event
    yield {
      type: 'init',
      sessionId,
      model,
      tools: ctx.tools.map((t) => t.name),
    };

    try {
      // Build initial conversation
      const messages = this.buildInitialMessages(ctx);
      const openaiTools = this.convertToolDefinitions(ctx.tools);

      // ─── Main agentic loop ─────────────────────────────────────────────
      while (turnCount < maxTurns) {
        // Check abort
        if (sessionAbort.signal.aborted) {
          yield {
            type: 'error',
            message: 'Session aborted',
            subtype: 'abort',
          };
          break;
        }

        turnCount++;

        // Check budget
        if (ctx.maxBudgetUsd && totalCost >= ctx.maxBudgetUsd) {
          yield {
            type: 'result',
            subtype: 'error_max_budget_usd',
            durationMs: Date.now() - startTime,
            costUsd: totalCost,
            numTurns: turnCount,
            sessionId,
          };
          break;
        }

        // Call the LLM with streaming — yield text deltas in real-time
        const streamResult = yield* this.runStreamingTurn(
          messages,
          openaiTools,
          model,
          ctx.systemPrompt ?? undefined,
          sessionAbort.signal,
        );

        // Track usage / cost
        if (streamResult.usage) {
          totalCost += estimateCost(streamResult.usage.total_tokens, model);
        }

        // Check for tool calls
        if (!streamResult.toolCalls || streamResult.toolCalls.length === 0) {
          // No tool calls — agent is done
          break;
        }

        // Add assistant message to conversation history
        messages.push({
          role: 'assistant',
          content: streamResult.textContent || null,
          tool_calls: streamResult.toolCalls,
        });

        // Execute all tool calls and yield results
        for (const toolCall of streamResult.toolCalls!) {
          const toolName = toolCall.function.name;
          let toolInput: Record<string, unknown>;

          try {
            toolInput = JSON.parse(toolCall.function.arguments);
          } catch (parseError) {
            // Invalid JSON from LLM — report error and use empty object
            yield {
              type: 'system',
              subtype: 'tool_parse_error',
              data: {
                toolId: toolCall.id,
                toolName,
                rawArguments: toolCall.function.arguments,
                error: parseError instanceof Error ? parseError.message : String(parseError),
              },
            };
            toolInput = {};
          }

          // Yield tool_use event
          yield {
            type: 'tool_use',
            id: toolCall.id,
            name: toolName,
            input: toolInput,
          };

          // Execute the tool
          let toolResultContent: string;
          let isError = false;

          try {
            const result = await ctx.toolExecutor(toolName, toolInput);
            toolResultContent =
              typeof result.content === 'string'
                ? result.content
                : JSON.stringify(result.content);
            isError = result.isError ?? false;
          } catch (error: unknown) {
            toolResultContent = `Tool execution error: ${error instanceof Error ? error.message : String(error)}`;
            isError = true;
          }

          // Yield tool_result event
          yield {
            type: 'tool_result',
            toolUseId: toolCall.id,
            content: toolResultContent,
            isError,
          };

          // Add tool result to conversation history
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResultContent,
          });
        }

        // Continue the loop — next iteration will call LLM again
      }

      // Check if we hit max turns
      if (turnCount >= maxTurns) {
        yield {
          type: 'result',
          subtype: 'error_max_turns',
          durationMs: Date.now() - startTime,
          costUsd: totalCost > 0 ? totalCost : undefined,
          numTurns: turnCount,
          sessionId,
        };
      } else if (!sessionAbort.signal.aborted) {
        yield {
          type: 'result',
          subtype: 'completed',
          durationMs: Date.now() - startTime,
          costUsd: totalCost > 0 ? totalCost : undefined,
          numTurns: turnCount,
          sessionId,
        };
      }
    } catch (error: unknown) {
      yield {
        type: 'error',
        message: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        subtype: 'unknown',
      };
    } finally {
      // Cleanup
      ctx.signal.removeEventListener('abort', onExternalAbort);
      this.abortControllers.delete(sessionId);
    }
  }

  // ─── Message Building ──────────────────────────────────────────────────

  /**
   * Build the initial conversation messages array.
   * System prompt is sent separately in the API call, not as a message.
   */
  private buildInitialMessages(ctx: AgentRunContext): OpenAIMessage[] {
    const messages: OpenAIMessage[] = [];

    // User prompt
    messages.push({
      role: 'user',
      content: ctx.prompt,
    });

    return messages;
  }

  // ─── Streaming Turn ────────────────────────────────────────────────────

  /**
   * Run a single streaming LLM turn with retry logic.
   * Yields TextEvent chunks in real-time as they arrive from the API.
   * Returns the accumulated result (tool calls, usage) when streaming completes.
   */
  private async *runStreamingTurn(
    messages: OpenAIMessage[],
    tools: OpenAITool[],
    model: string,
    systemPrompt: string | undefined,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent, StreamTurnResult, undefined> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (signal.aborted) {
        throw new Error('Aborted');
      }

      try {
        return yield* this.executeStreamingTurn(messages, tools, model, systemPrompt, signal);
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (signal.aborted) throw new Error('Aborted');
        if (isNonRetryableError(error)) throw error;

        if (attempt < this.maxRetries) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          await sleep(delay, signal);
        }
      }
    }

    throw lastError ?? new Error('Max retries exceeded');
  }

  /**
   * Execute a single streaming turn — reads SSE stream and yields text deltas.
   * Returns StreamTurnResult with accumulated tool calls and usage.
   */
  private async *executeStreamingTurn(
    messages: OpenAIMessage[],
    tools: OpenAITool[],
    model: string,
    systemPrompt: string | undefined,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent, StreamTurnResult, undefined> {
    const url = `${this.endpoint.replace(/\/+$/, '')}/chat/completions`;

    // Build request body
    const body: Record<string, unknown> = {
      model,
      messages: this.buildAPIMessages(messages, systemPrompt),
      stream: true,
    };

    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    // Create timeout controller
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const combinedSignal = combineSignals(signal, timeoutController.signal);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          ...this.headers,
        },
        body: JSON.stringify(body),
        signal: combinedSignal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'unknown');
        throw new APIError(
          `OpenAI API error ${response.status}: ${errorBody}`,
          response.status,
        );
      }

      // Process SSE stream — yield text deltas in real-time
      const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();
      let textContent = '';
      let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;

      for await (const chunk of readSSEStream(response, combinedSignal)) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Yield text content in real-time as it arrives
        if (delta.content) {
          textContent += delta.content;
          yield { type: 'text', content: delta.content };
        }

        // Accumulate tool calls from deltas
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            const existing = toolCallsMap.get(idx);

            if (existing) {
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            } else if (tc.id || tc.function?.name) {
              toolCallsMap.set(idx, {
                id: tc.id ?? `call_${idx}`,
                name: tc.function?.name ?? '',
                arguments: tc.function?.arguments ?? '',
              });
            }
          }
        }

        // Track usage (sent in last chunk)
        if (chunk.usage) {
          usage = chunk.usage;
        }
      }

      // Convert accumulated tool calls to array
      const toolCalls =
        toolCallsMap.size > 0
          ? Array.from(toolCallsMap.entries())
              .sort(([a], [b]) => a - b)
              .map(
                ([, tc]) =>
                  ({
                    id: tc.id,
                    type: 'function',
                    function: {
                      name: tc.name,
                      arguments: tc.arguments,
                    },
                  }) as OpenAIToolCall,
              )
          : undefined;

      return { textContent, toolCalls, usage };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Tool Conversion ───────────────────────────────────────────────────

  /**
   * Convert internal ToolDefinitions to OpenAI function calling format.
   */
  private convertToolDefinitions(tools: ToolDefinition[]): OpenAITool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  // ─── LLM API Call ──────────────────────────────────────────────────────

  /**
   * Build the messages array for the OpenAI API request.
   * Inserts system prompt as the first message if provided.
   */
  private buildAPIMessages(
    messages: OpenAIMessage[],
    systemPrompt: string | undefined,
  ): OpenAIMessage[] {
    if (!systemPrompt) {
      return messages;
    }

    return [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];
  }
}

// ─── Streaming Implementation ────────────────────────────────────────────────


/**
 * Parse an SSE line from OpenAI's streaming response.
 * Returns null for non-data lines or [DONE].
 */
function parseSSELine(line: string): OpenAIStreamChunk | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data: ')) return null;
  const data = trimmed.slice(6);
  if (data === '[DONE]') return null;
  try {
    return JSON.parse(data) as OpenAIStreamChunk;
  } catch {
    return null;
  }
}

/**
 * Read an SSE stream from a fetch Response, yielding parsed chunks.
 * Handles the SSE protocol: lines starting with "data: " contain JSON payloads.
 */
async function* readSSEStream(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<OpenAIStreamChunk> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body is not readable');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const chunk = parseSSELine(line);
        if (chunk) yield chunk;
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      const chunk = parseSSELine(buffer);
      if (chunk) yield chunk;
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

/** Generate a unique session ID using crypto */
function generateSessionId(): string {
  return `oai-${randomUUID()}`;
}

/** Sleep with abort support */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }

    const timer = setTimeout(resolve, ms);

    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      },
      { once: true },
    );
  });
}

/**
 * Combine multiple AbortSignals into one.
 * Uses AbortSignal.any() (Node 20+) to avoid listener leak.
 */
function combineSignals(...signals: AbortSignal[]): AbortSignal {
  // Filter out already-aborted signals
  if (signals.some((s) => s.aborted)) {
    return AbortSignal.abort();
  }
  // AbortSignal.any() handles cleanup internally — no listener leak
  return AbortSignal.any(signals);
}

/** Check if an error is non-retryable (4xx except 429) */
function isNonRetryableError(error: unknown): boolean {
  if (error instanceof APIError) {
    return error.status >= 400 && error.status < 500 && error.status !== 429;
  }
  return false;
}

/**
 * Estimate cost in USD based on token count and model.
 * Very rough estimates for common models.
 */
function estimateCost(totalTokens: number, model: string): number {
  const modelLower = model.toLowerCase();

  // Price per 1M tokens (input+output average, rough estimate)
  // Ordered by specificity — longer names first to avoid prefix collisions
  const priceMap: Array<[string, number]> = [
    ['gpt-4o-mini', 0.3],
    ['gpt-4o', 5.0],
    ['gpt-4-turbo', 15.0],
    ['gpt-4', 45.0],
    ['gpt-3.5-turbo', 0.5],
    ['deepseek-reasoner', 0.55],
    ['deepseek-chat', 0.27],
    ['deepseek-coder', 0.27],
    ['claude-3.5-sonnet', 5.0],
    ['claude-3-opus', 22.5],
    ['claude-3-sonnet', 5.25],
    ['claude-3-haiku', 0.375],
  ];

  // Exact match first, then prefix match
  for (const [key, price] of priceMap) {
    if (modelLower === key || modelLower.startsWith(key + '-') || modelLower.startsWith(key + ':')) {
      return (totalTokens / 1_000_000) * price;
    }
  }

  // Default: assume $1 per 1M tokens (conservative)
  return (totalTokens / 1_000_000) * 1.0;
}

/** Custom error class for API errors */
class APIError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'APIError';
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Factory function to create an OpenAICompatBackend instance.
 * Conforms to the BackendFactory type.
 */
export function createOpenAICompatBackend(config: BackendConfig): OpenAICompatBackend {
  return new OpenAICompatBackend(config);
}
