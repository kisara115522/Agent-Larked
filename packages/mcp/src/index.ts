#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getDatabase } from './db.js';
import { registerIdentityTools } from './tools/identity.js';
import { registerRoomTools } from './tools/room.js';

const server = new McpServer({
  name: 'flock',
  version: '0.1.0',
});

const db = getDatabase();

// Register all tool groups
registerIdentityTools(server, db);
registerRoomTools(server, db);

// Connect via stdio
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Flock MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
