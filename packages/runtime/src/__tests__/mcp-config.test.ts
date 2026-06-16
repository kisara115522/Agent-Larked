import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { writeMcpConfigToTemp } from '../backends/mcp-config.js';
import type { MCPServerConfig } from '../backends/types.js';

describe('writeMcpConfigToTemp', () => {
  const cleanupHandlers: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanupHandlers.splice(0)) {
      cleanup();
    }
  });

  it('writes a valid JSON file with stdio server', () => {
    const servers: MCPServerConfig[] = [
      {
        name: 'flock',
        transport: {
          type: 'stdio',
          command: 'node',
          args: ['packages/mcp/dist/index.js'],
          env: { DB_PATH: '/tmp/test.db', AGENT_NAME: 'bot' },
        },
      },
    ];
    const config = writeMcpConfigToTemp(servers);
    cleanupHandlers.push(config.cleanup);

    const raw = readFileSync(config.path, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const mcpServers = parsed.mcpServers as Record<string, Record<string, unknown>>;

    expect(mcpServers.flock).toBeDefined();
    expect(mcpServers.flock.type).toBe('stdio');
    expect(mcpServers.flock.command).toBe('node');
    expect(mcpServers.flock.args).toEqual(['packages/mcp/dist/index.js']);
    expect((mcpServers.flock.env as Record<string, string>).DB_PATH).toBe('/tmp/test.db');
  });

  it('writes a valid JSON file with sse server', () => {
    const servers: MCPServerConfig[] = [
      {
        name: 'remote',
        transport: {
          type: 'sse',
          url: 'http://localhost:8080/sse',
          headers: { Authorization: 'Bearer tok' },
        },
      },
    ];
    const config = writeMcpConfigToTemp(servers);
    cleanupHandlers.push(config.cleanup);

    const raw = readFileSync(config.path, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const mcpServers = parsed.mcpServers as Record<string, Record<string, unknown>>;

    expect(mcpServers.remote).toBeDefined();
    expect(mcpServers.remote.type).toBe('sse');
    expect(mcpServers.remote.url).toBe('http://localhost:8080/sse');
    expect((mcpServers.remote.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('cleanup removes the temp file', () => {
    const config = writeMcpConfigToTemp([]);
    const { path, cleanup } = config;

    expect(existsSync(path)).toBe(true);
    cleanup();
    expect(existsSync(path)).toBe(false);
  });

  it('handles multiple servers', () => {
    const servers: MCPServerConfig[] = [
      { name: 'a', transport: { type: 'stdio', command: 'node', args: ['a.js'] } },
      { name: 'b', transport: { type: 'sse', url: 'http://b/sse' } },
    ];
    const config = writeMcpConfigToTemp(servers);
    cleanupHandlers.push(config.cleanup);

    const raw = readFileSync(config.path, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const mcpServers = parsed.mcpServers as Record<string, unknown>;
    expect(Object.keys(mcpServers)).toEqual(['a', 'b']);
  });
});
