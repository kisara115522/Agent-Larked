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

import type {
  AgentBackend,
  AgentRunContext,
  AgentEvent,
  ToolDefinition,
  BackendConfig,
  JsonSchema,
} from './types.js';

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

/** OpenAI non-streaming response */
interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: OpenAIToolCall[];
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

    // Link external signal to our controller
    const onExternalAbort = () => sessionAbort.abort();
    ctx.signal.addEventListener('abort', onExternalAbort, { once: true });

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

        // Call the LLM with streaming for real-time text output
        let response: OpenAIResponse;
        try {
          response = await this.callLLMStreaming(
            messages,
            openaiTools,
            model,
            ctx.systemPrompt,
            sessionAbort.signal,
            (textDelta) => {
              // Yield text chunks as they arrive for real-time output
              // Note: this callback is used to forward text deltas to the caller
              // We store them and yield after the stream completes
            },
          );
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          if (sessionAbort.signal.aborted) {
            yield { type: 'error', message: 'Session aborted', subtype: 'abort' };
          } else {
            yield { type: 'error', message: `API error: ${msg}`, subtype: 'api_error' };
          }
          break;
        }

        // Parse the assistant message
        const choice = response.choices?.[0];
        if (!choice) {
          yield {
            type: 'error',
            message: 'No choices in API response',
            subtype: 'api_error',
          };
          break;
        }

        const assistantMessage = choice.message;

        // Track usage / cost
        if (response.usage) {
          totalCost += estimateCost(response.usage.total_tokens, model);
        }

        // Emit text content
        if (assistantMessage.content) {
          yield {
            type: 'text',
            content: assistantMessage.content,
          };
        }

        // Check for tool calls
        const toolCalls = assistantMessage.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
          // No tool calls — agent is done
          break;
        }

        // Add assistant message to conversation history
        messages.push({
          role: 'assistant',
          content: assistantMessage.content ?? null,
          tool_calls: toolCalls,
        });

        // Execute all tool calls and yield results
        for (const toolCall of toolCalls) {
          const toolName = toolCall.function.name;
          let toolInput: Record<string, unknown>;

          try {
            toolInput = JSON.parse(toolCall.function.arguments);
          } catch {
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
   * Call the OpenAI-compatible API with retry logic for transient errors.
   * Uses streaming mode for real-time text output.
   */
  private async callLLMWithRetry(
    messages: OpenAIMessage[],
    tools: OpenAITool[],
    model: string,
    systemPrompt: string | undefined,
    signal: AbortSignal,
  ): Promise<OpenAIResponse> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (signal.aborted) {
        throw new Error('Aborted');
      }

      try {
        return await this.callLLM(messages, tools, model, systemPrompt, signal);
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on abort
        if (signal.aborted) {
          throw new Error('Aborted');
        }

        // Don't retry on 4xx errors (except 429 rate limit)
        if (isNonRetryableError(error)) {
          throw error;
        }

        // Retry with exponential backoff
        if (attempt < this.maxRetries) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          await sleep(delay, signal);
        }
      }
    }

    throw lastError ?? new Error('Max retries exceeded');
  }

  /**
   * Call the LLM with streaming support.
   * Streams text deltas via callback and accumulates tool calls.
   * Returns the complete response when streaming finishes.
   */
  private async callLLMStreaming(
    messages: OpenAIMessage[],
    tools: OpenAITool[],
    model: string,
    systemPrompt: string | undefined,
    signal: AbortSignal,
    onTextDelta: (delta: string) => void,
  ): Promise<OpenAIResponse> {
    const url = `${this.endpoint.replace(/\/+$/, '')}/chat/completions`;

    // Build request body — enable streaming
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
          Authorization: `Bearer ${this.apiKey}`,
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

      // Process SSE stream
      const accumulator: StreamAccumulator = {
        content: '',
        toolCalls: new Map(),
        finishReason: null,
      };

      let chunkId = '';
      let chunkModel = '';

      for await (const chunk of readSSEStream(response, combinedSignal)) {
        chunkId = chunk.id;
        chunkModel = chunk.model;

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Accumulate text content
        if (delta.content) {
          accumulator.content += delta.content;
          onTextDelta(delta.content);
        }

        // Accumulate tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            const existing = accumulator.toolCalls.get(idx);

            if (existing) {
              // Update existing tool call
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            } else if (tc.id || tc.function?.name) {
              // Create new tool call
              accumulator.toolCalls.set(idx, {
                id: tc.id ?? `call_${idx}`,
                name: tc.function?.name ?? '',
                arguments: tc.function?.arguments ?? '',
              });
            }
          }
        }

        // Track finish reason
        if (choice.finish_reason) {
          accumulator.finishReason = choice.finish_reason;
        }

        // Track usage (sent in last chunk)
        if (chunk.usage) {
          accumulator.usage = chunk.usage;
        }
      }

      // Convert accumulator to OpenAIResponse format
      const toolCallsArray =
        accumulator.toolCalls.size > 0
          ? Array.from(accumulator.toolCalls.entries())
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

      return {
        id: chunkId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: chunkModel,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: accumulator.content || null,
              tool_calls: toolCallsArray,
            },
            finish_reason: accumulator.finishReason,
          },
        ],
        usage: accumulator.usage,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Make a single call to the OpenAI-compatible Chat Completions API.
   * Uses non-streaming mode for simplicity (streaming support planned).
   */
  private async callLLM(
    messages: OpenAIMessage[],
    tools: OpenAITool[],
    model: string,
    systemPrompt: string | undefined,
    signal: AbortSignal,
  ): Promise<OpenAIResponse> {
    const url = `${this.endpoint.replace(/\/+$/, '')}/chat/completions`;

    // Build request body
    const body: Record<string, unknown> = {
      model,
      messages: this.buildAPIMessages(messages, systemPrompt),
      stream: false,
    };

    // Only include tools if we have them
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    // Create timeout controller
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), this.timeoutMs);

    // Combine signals
    const combinedSignal = combineSignals(signal, timeoutController.signal);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
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

      const data = (await response.json()) as OpenAIResponse;
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

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
 * Accumulated result from a streaming LLM response.
 * As SSE chunks arrive, we accumulate text and tool calls into this structure.
 */
interface StreamAccumulator {
  content: string;
  toolCalls: Map<
    number,
    {
      id: string;
      name: string;
      arguments: string;
    }
  >;
  finishReason: string | null;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

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

/** Generate a unique session ID */
function generateSessionId(): string {
  return `oai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

/** Combine multiple AbortSignals into one */
function combineSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return controller.signal;
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
  const priceMap: Record<string, number> = {
    'gpt-4o': 5.0,
    'gpt-4o-mini': 0.3,
    'gpt-4-turbo': 15.0,
    'gpt-4': 45.0,
    'gpt-3.5-turbo': 0.5,
    'deepseek-chat': 0.27,
    'deepseek-coder': 0.27,
    'deepseek-reasoner': 0.55,
    'claude-3-opus': 22.5,
    'claude-3-sonnet': 5.25,
    'claude-3-haiku': 0.375,
  };

  // Find matching price
  for (const [key, price] of Object.entries(priceMap)) {
    if (modelLower.includes(key)) {
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
