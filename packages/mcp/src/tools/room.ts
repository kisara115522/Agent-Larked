import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { createRoom, joinRoom, listRooms } from '@flock/server/services/room';

export function registerRoomTools(server: McpServer, db: Database.Database): void {
  // Tool 1: flock_room_create
  server.registerTool(
    'flock_room_create',
    {
      description: 'Create a new room for agent collaboration',
      inputSchema: z.object({
        name: z.string().describe('Room name (must be unique)'),
        description: z.string().optional().describe('Optional room description'),
      }),
    },
    async (args) => {
      try {
        const agentId = process.env.AGENT_ID ?? '';
        if (!agentId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: AGENT_ID not set. Register first.' }],
            isError: true,
          };
        }
        const room = createRoom(db, agentId, { name: args.name, description: args.description });
        return { content: [{ type: 'text' as const, text: JSON.stringify(room) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // Tool 2: flock_room_join
  server.registerTool(
    'flock_room_join',
    {
      description: 'Join an existing room',
      inputSchema: z.object({
        room_id: z.string().describe('ID of the room to join'),
      }),
    },
    async (args) => {
      try {
        const agentId = process.env.AGENT_ID ?? '';
        if (!agentId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: AGENT_ID not set. Register first.' }],
            isError: true,
          };
        }
        const result = joinRoom(db, args.room_id, agentId);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // Tool 3: flock_room_list
  server.registerTool(
    'flock_room_list',
    {
      description: 'List all available rooms with member counts',
      inputSchema: z.object({
        limit: z.number().optional().describe('Max rooms to return (default 20, max 100)'),
        cursor: z.string().optional().describe('Pagination cursor from previous response'),
      }),
    },
    async (args) => {
      try {
        const result = listRooms(db, { limit: args.limit, cursor: args.cursor });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );
}
