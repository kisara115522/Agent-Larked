import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { searchAgents } from '@flock/server/services/identity';
import { listRooms } from '@flock/server/services/room';
import { getMessages } from '@flock/server/services/messaging';

export function registerResources(server: McpServer, db: Database.Database): void {
  // Static resource: all registered agents
  server.registerResource(
    'agents',
    'flock://agents',
    {
      title: 'Registered Agents',
      description: 'List of all registered agents',
      mimeType: 'application/json',
    },
    async (uri) => {
      const result = searchAgents(db, { limit: 100 });
      return { contents: [{ uri: uri.href, text: JSON.stringify(result.agents) }] };
    },
  );

  // Static resource: all rooms
  server.registerResource(
    'rooms',
    'flock://rooms',
    {
      title: 'All Rooms',
      description: 'List of all available rooms',
      mimeType: 'application/json',
    },
    async (uri) => {
      const result = listRooms(db, { limit: 100 });
      return { contents: [{ uri: uri.href, text: JSON.stringify(result.rooms) }] };
    },
  );

  // Dynamic resource: messages in a specific room
  server.registerResource(
    'room-messages',
    new ResourceTemplate('flock://rooms/{room_id}/messages', {
      list: async () => ({ resources: [] }),
    }),
    {
      title: 'Room Messages',
      description: 'Messages in a specific room',
      mimeType: 'application/json',
    },
    async (uri, { room_id }) => {
      const result = getMessages(db, room_id as string, { limit: 50 });
      return { contents: [{ uri: uri.href, text: JSON.stringify(result.messages) }] };
    },
  );
}
