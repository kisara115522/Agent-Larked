/**
 * Tests for backend abstraction types and config loading.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadBackendConfig } from '../config.js';
import type {
  AgentBackend,
  AgentRunContext,
  AgentEvent,
  ToolDefinition,
  ToolResult,
  ToolExecutor,
  MCPServerConfig,
  BackendConfig,
  BackendType,
  JsonSchema,
} from '../backends/types.js';

// ─── Type Compatibility Tests ────────────────────────────────────────────────

describe('Backend Types', () => {
  describe('AgentBackend interface', () => {
    it('should accept a valid backend implementation', () => {
      const backend: AgentBackend = {
        name: 'test-backend',
        run: async function* () {
          yield { type: 'init', sessionId: 's1', model: 'test', tools: [] };
          yield { type: 'text', content: 'hello' };
          yield { type: 'result', subtype: 'completed', durationMs: 100, sessionId: 's1' };
        },
        abort: () => {},
      };

      expect(backend.name).toBe('test-backend');
      expect(typeof backend.run).toBe('function');
      expect(typeof backend.abort).toBe('function');
    });

    it('should accept a backend with optional resume', () => {
      const backend: AgentBackend = {
        name: 'test-resume',
        run: async function* () {},
        abort: () => {},
        resume: async function* () {
          yield { type: 'text', content: 'resumed' };
        },
      };

      expect(backend.resume).toBeDefined();
    });
  });

  describe('AgentEvent types', () => {
    it('should accept InitEvent', () => {
      const event: AgentEvent = {
        type: 'init',
        sessionId: 'sess-1',
        model: 'claude-sonnet-4-20250514',
        tools: ['Read', 'Edit', 'Write'],
        mcpServers: [{ name: 'flock', status: 'connected' }],
      };
      expect(event.type).toBe('init');
    });

    it('should accept TextEvent', () => {
      const event: AgentEvent = { type: 'text', content: 'Hello world' };
      expect(event.type).toBe('text');
    });

    it('should accept ThinkingEvent', () => {
      const event: AgentEvent = { type: 'thinking', content: 'Let me think...' };
      expect(event.type).toBe('thinking');
    });

    it('should accept ToolUseEvent', () => {
      const event: AgentEvent = {
        type: 'tool_use',
        id: 'tu_1',
        name: 'Read',
        input: { file_path: '/tmp/test.txt' },
      };
      expect(event.type).toBe('tool_use');
    });

    it('should accept ToolResultEvent', () => {
      const event: AgentEvent = {
        type: 'tool_result',
        toolUseId: 'tu_1',
        content: 'file contents',
        isError: false,
      };
      expect(event.type).toBe('tool_result');
    });

    it('should accept ResultEvent with all subtypes', () => {
      const subtypes = ['completed', 'success', 'error_during_execution', 'error_max_turns', 'error_max_budget_usd', 'error_max_structured_output_retries'] as const;
      for (const subtype of subtypes) {
        const event: AgentEvent = {
          type: 'result',
          subtype,
          durationMs: 5000,
          sessionId: 'sess-1',
          costUsd: 0.05,
          numTurns: 3,
        };
        expect(event.type).toBe('result');
        expect(event.subtype).toBe(subtype);
      }
    });

    it('should accept ErrorEvent with all subtypes', () => {
      const subtypes = ['api_error', 'tool_error', 'auth_error', 'abort', 'unknown'] as const;
      for (const subtype of subtypes) {
        const event: AgentEvent = {
          type: 'error',
          message: 'Something went wrong',
          subtype,
        };
        expect(event.type).toBe('error');
        expect(event.subtype).toBe(subtype);
      }
    });

    it('should accept SystemEvent', () => {
      const event: AgentEvent = {
        type: 'system',
        subtype: 'custom',
        data: { key: 'value' },
      };
      expect(event.type).toBe('system');
    });
  });

  describe('ToolDefinition', () => {
    it('should accept a valid tool definition', () => {
      const tool: ToolDefinition = {
        name: 'Read',
        description: 'Read a file from disk',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Absolute path to the file' },
          },
          required: ['file_path'],
        },
      };
      expect(tool.name).toBe('Read');
    });
  });

  describe('ToolResult', () => {
    it('should accept a text result', () => {
      const result: ToolResult = {
        content: 'file contents here',
        isError: false,
      };
      expect(result.content).toBe('file contents here');
    });

    it('should accept a result with content blocks', () => {
      const result: ToolResult = {
        content: 'screenshot taken',
        contentBlocks: [
          { type: 'text', text: 'Here is the image' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'iVBOR...' },
          },
        ],
      };
      expect(result.contentBlocks).toHaveLength(2);
    });
  });

  describe('MCPServerConfig', () => {
    it('should accept stdio transport', () => {
      const config: MCPServerConfig = {
        name: 'flock',
        transport: {
          type: 'stdio',
          command: 'node',
          args: ['packages/mcp/dist/index.js'],
          env: { DB_PATH: '/tmp/db' },
        },
      };
      expect(config.transport.type).toBe('stdio');
    });

    it('should accept SSE transport', () => {
      const config: MCPServerConfig = {
        name: 'remote-server',
        transport: {
          type: 'sse',
          url: 'http://localhost:8080/sse',
          headers: { Authorization: 'Bearer token' },
        },
      };
      expect(config.transport.type).toBe('sse');
    });
  });

  describe('BackendConfig', () => {
    it('should accept claude-sdk config', () => {
      const config: BackendConfig = {
        type: 'claude-sdk',
        model: 'claude-sonnet-4-20250514',
      };
      expect(config.type).toBe('claude-sdk');
    });

    it('should accept openai-compat config', () => {
      const config: BackendConfig = {
        type: 'openai-compat',
        apiEndpoint: 'https://api.deepseek.com/v1',
        apiKey: 'sk-test',
        model: 'deepseek-chat',
        timeoutMs: 60000,
        maxRetries: 3,
      };
      expect(config.type).toBe('openai-compat');
      expect(config.apiEndpoint).toBe('https://api.deepseek.com/v1');
    });
  });

  describe('ToolExecutor', () => {
    it('should be callable with name and input', async () => {
      const executor: ToolExecutor = async (name, input) => {
        return { content: `Executed ${name} with ${JSON.stringify(input)}` };
      };

      const result = await executor('Read', { file_path: '/tmp/test' });
      expect(result.content).toContain('Read');
      expect(result.content).toContain('/tmp/test');
    });
  });

  describe('JsonSchema', () => {
    it('should accept a valid tool schema', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to file' },
          encoding: { type: 'string', enum: ['utf-8', 'ascii'] },
          line_count: { type: 'number' },
          verbose: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['file_path'],
        additionalProperties: false,
      };
      expect(schema.type).toBe('object');
      expect(schema.required).toContain('file_path');
    });
  });
});

// ─── Config Loading Tests ────────────────────────────────────────────────────

describe('loadBackendConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clean backend-related env vars
    delete process.env.BACKEND_TYPE;
    delete process.env.OPENAI_API_ENDPOINT;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_TIMEOUT_MS;
    delete process.env.OPENAI_MAX_RETRIES;
    delete process.env.OPENAI_MODEL;
    delete process.env.AGENT_MODEL;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it('should default to claude-sdk backend', () => {
    const config = loadBackendConfig();
    expect(config.type).toBe('claude-sdk');
    expect(config.apiEndpoint).toBeUndefined();
    expect(config.apiKey).toBeUndefined();
  });

  it('should load claude-sdk backend with model override', () => {
    process.env.AGENT_MODEL = 'claude-opus-4-20250514';
    const config = loadBackendConfig();
    expect(config.type).toBe('claude-sdk');
    expect(config.model).toBe('claude-opus-4-20250514');
  });

  it('should load openai-compat backend config', () => {
    process.env.BACKEND_TYPE = 'openai-compat';
    process.env.OPENAI_API_ENDPOINT = 'https://api.deepseek.com/v1';
    process.env.OPENAI_API_KEY = 'sk-test-key';
    process.env.OPENAI_TIMEOUT_MS = '60000';
    process.env.OPENAI_MAX_RETRIES = '5';
    process.env.OPENAI_MODEL = 'deepseek-chat';

    const config = loadBackendConfig();
    expect(config.type).toBe('openai-compat');
    expect(config.apiEndpoint).toBe('https://api.deepseek.com/v1');
    expect(config.apiKey).toBe('sk-test-key');
    expect(config.timeoutMs).toBe(60000);
    expect(config.maxRetries).toBe(5);
    expect(config.model).toBe('deepseek-chat');
  });

  it('should use defaults for openai-compat optional fields', () => {
    process.env.BACKEND_TYPE = 'openai-compat';
    process.env.OPENAI_API_KEY = 'sk-test';

    const config = loadBackendConfig();
    expect(config.type).toBe('openai-compat');
    expect(config.apiEndpoint).toBe('https://api.openai.com/v1');
    expect(config.timeoutMs).toBe(120_000);
    expect(config.maxRetries).toBe(3);
  });

  it('should accept various backend types', () => {
    const types: BackendType[] = ['claude-sdk', 'openai-compat'];
    for (const type of types) {
      process.env.BACKEND_TYPE = type;
      if (type === 'openai-compat') process.env.OPENAI_API_KEY = 'test';
      const config = loadBackendConfig();
      expect(config.type).toBe(type);
    }
  });
});
