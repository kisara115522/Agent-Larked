import { describe, it, expect } from 'vitest';
import { AgentHarness } from '../harness/agent-harness.js';
import type { MCPServerConfig } from '../backends/types.js';

describe('AgentHarness buildMcpServers', () => {
  it('prepends built-in flock, appends extraMcpServers', () => {
    const harness = new AgentHarness({
      flockServerUrl: 'http://x',
      cwd: '/tmp',
      mcpServerPath: '/tmp/mcp.js',
      dbPath: '/tmp/db',
      reportActivity: async () => {},
    });

    const extra: MCPServerConfig[] = [
      { name: 'echo', transport: { type: 'stdio', command: 'echo' } },
    ];
    // buildMcpServers is private; use bracket-access for the test.
    const servers = (harness as unknown as {
      buildMcpServers: (req: { agentName: string; agentToken?: string; extraMcpServers?: MCPServerConfig[] }) => MCPServerConfig[];
    }).buildMcpServers({ agentName: 'x', extraMcpServers: extra });

    expect(servers[0].name).toBe('flock');
    expect(servers[1].name).toBe('echo');
  });
});
