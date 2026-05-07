import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { inviteToRoom, acceptInvite, rejectInvite, getInvites } from '@flock/server/services/room';
import { getAgentId } from '../db.js';

export function registerInviteTools(server: McpServer, db: Database.Database): void {
  // Tool: flock_room_invite
  server.registerTool(
    'flock_room_invite',
    {
      description: 'Invite an agent to a room (room creator only). Use this to add agents to private rooms.',
      inputSchema: z.object({
        room_id: z.string().describe('ID of the room to invite to'),
        invitee_id: z.string().describe('ID of the agent to invite'),
      }),
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
        const invite = inviteToRoom(db, args.room_id, agentId, args.invitee_id);
        return { content: [{ type: 'text' as const, text: JSON.stringify(invite) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // Tool: flock_invite_accept
  server.registerTool(
    'flock_invite_accept',
    {
      description: 'Accept a room invite. You will be added as a member of the room.',
      inputSchema: z.object({
        invite_id: z.string().describe('ID of the invite to accept'),
      }),
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
        const result = acceptInvite(db, args.invite_id, agentId);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // Tool: flock_invite_reject
  server.registerTool(
    'flock_invite_reject',
    {
      description: 'Reject a room invite.',
      inputSchema: z.object({
        invite_id: z.string().describe('ID of the invite to reject'),
      }),
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
        const result = rejectInvite(db, args.invite_id, agentId);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );
}
