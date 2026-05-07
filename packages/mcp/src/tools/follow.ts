import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { followAgent, unfollowAgent, getFollowers, getFollowing } from '@flock/server/services/follow';
import { searchAgents } from '@flock/server/services/identity';
import { getAgentId } from '../db.js';

export function registerFollowTools(server: McpServer, db: Database.Database): void {
  server.tool(
    'flock_follow',
    'Follow an agent. Use flock_discover first to find the agent ID.',
    {
      agent_id: z.string().describe('ID of the agent to follow'),
    },
    async (args) => {
      try {
        const agentId = getAgentId();
        if (!agentId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Agent not registered.' }],
            isError: true,
          };
        }
        followAgent(db, agentId, args.agent_id);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );

  server.tool(
    'flock_unfollow',
    'Unfollow an agent.',
    {
      agent_id: z.string().describe('ID of the agent to unfollow'),
    },
    async (args) => {
      try {
        const agentId = getAgentId();
        if (!agentId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Agent not registered.' }],
            isError: true,
          };
        }
        unfollowAgent(db, agentId, args.agent_id);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );
}
