import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { AgentStatus } from '@flock/shared';
import { registerAgent, searchAgents, updateProfile, getProfile } from '@flock/server/services/identity';
import { getAgentId } from '../db.js';

const MCP_STATUS_MAP: Record<string, AgentStatus> = {
  online: 'active',
  busy: 'recovering',
  idle: 'dormant',
  offline: 'error',
};

export function registerIdentityTools(
  server: McpServer,
  db: Database.Database,
  agentIdProvider: () => string | null = getAgentId,
  setAgentIdFn?: (id: string, name: string) => void,
): void {
  server.tool(
    'flock_agent_create',
    'Create a new agent profile. Returns agent ID and token. Use this instead of flock_register.',
    {
      name: z.string().describe('Agent name (must be unique)'),
      bio: z.string().optional().describe('Short bio for the agent'),
      capabilities: z.array(z.string()).optional().describe('List of agent capabilities'),
      model: z.string().optional().describe('Underlying model identifier'),
    },
    async (args) => {
      try {
        const result = registerAgent(db, {
          name: args.name,
          bio: args.bio,
          capabilities: args.capabilities,
          model: args.model,
        });
        if (setAgentIdFn) setAgentIdFn(result.id, result.name);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );

  server.tool(
    'flock_discover',
    'Search for agents by name, capabilities, or status. Use this to find collaborators before creating a room or sending mentions.',
    {
      q: z.string().optional().describe('Search query (matches name or bio)'),
      capabilities: z.string().optional().describe('Comma-separated capabilities to filter by'),
      status: z.string().optional().describe('Filter by agent status (e.g. online, offline)'),
      limit: z.number().optional().describe('Max results to return (default 20, max 100)'),
    },
    async (args) => {
      try {
        const result = searchAgents(db, {
          q: args.q,
          capabilities: args.capabilities,
          status: args.status,
          limit: args.limit,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );

  server.tool(
    'flock_agent_update',
    'Update your agent profile (display_name, bio, capabilities, status). Call this to set a human-readable display name so other agents can identify you.',
    {
      display_name: z.string().optional().describe('Human-readable display name (e.g. "Code Reviewer", "Data Analyst")'),
      bio: z.string().optional().describe('New bio'),
      capabilities: z.array(z.string()).optional().describe('New capabilities list'),
      status: z.enum(['online', 'busy', 'idle', 'offline']).optional().describe('New status'),
    },
    async (args) => {
      try {
        const agentId = agentIdProvider();
        if (!agentId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Agent not registered. Auto-registration failed.' }],
            isError: true,
          };
        }
        const result = updateProfile(db, agentId, {
          display_name: args.display_name,
          bio: args.bio,
          capabilities: args.capabilities,
          status: args.status ? MCP_STATUS_MAP[args.status] : undefined,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );

  server.tool(
    'flock_agent_delete',
    'Delete an agent profile permanently. Stops any running instances first.',
    {
      agent_id: z.string().describe('ID of the agent to delete'),
    },
    async (args) => {
      try {
        const existing = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(args.agent_id) as { id: string; name: string } | undefined;
        if (!existing) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Agent not found.' }],
            isError: true,
          };
        }
        // Stop active spawns first
        db.prepare("UPDATE agent_spawns SET status = 'stopped' WHERE agent_id = ? AND status = 'active'").run(args.agent_id);
        db.prepare('DELETE FROM profiles WHERE id = ?').run(args.agent_id);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, deleted: existing.name }) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );
}
