/**
 * Write a --mcp-config JSON file for the claude CLI from our MCPServerConfig[].
 *
 * The CLI expects {"mcpServers":{"<name>":{...}}}. stdio servers use
 * {type:"stdio",command,args,env}; sse servers use {type:"sse",url,headers}.
 * Verified against claude CLI 2.1.178 (§3).
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MCPServerConfig } from './types.js';

export interface McpConfigFile {
  path: string;
  cleanup: () => void;
}

export function writeMcpConfigToTemp(servers: MCPServerConfig[]): McpConfigFile {
  const mcpServers: Record<string, unknown> = {};
  for (const s of servers) {
    if (s.transport.type === 'stdio') {
      mcpServers[s.name] = {
        type: 'stdio',
        command: s.transport.command,
        ...(s.transport.args ? { args: s.transport.args } : {}),
        ...(s.transport.env ? { env: s.transport.env } : {}),
      };
    } else if (s.transport.type === 'sse') {
      mcpServers[s.name] = {
        type: 'sse',
        url: s.transport.url,
        ...(s.transport.headers ? { headers: s.transport.headers } : {}),
      };
    }
  }

  const dir = mkdtempSync(join(tmpdir(), 'flock-mcp-'));
  const path = join(dir, 'mcp-config.json');
  writeFileSync(path, JSON.stringify({ mcpServers }, null, 2), { mode: 0o600 });

  return {
    path,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}
