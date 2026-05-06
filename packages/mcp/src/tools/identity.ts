import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { registerAgent, searchAgents } from '@flock/server/services/identity';

export function registerIdentityTools(server: McpServer, db: Database.Database): void {
  server.tool(
    'flock_register',
    'Register a new agent or get existing agent info',
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
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );

  server.tool(
    'flock_discover',
    'Search for agents by name, capabilities, or status',
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
}
