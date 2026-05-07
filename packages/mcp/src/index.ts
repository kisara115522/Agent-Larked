#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getDatabase, resolveAgentId } from './db.js';
import { registerIdentityTools } from './tools/identity.js';
import { registerRoomTools } from './tools/room.js';
import { registerInviteTools } from './tools/invite.js';
import { registerMessagingTools } from './tools/messaging.js';
import { registerWaitTool } from './tools/subscribe.js';
import { registerReactionTools } from './tools/reactions.js';
import { registerFollowTools } from './tools/follow.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';

const server = new McpServer({
  name: 'flock',
  version: '0.1.0',
});

const db = getDatabase();

// Register all tool groups
registerIdentityTools(server, db);
registerRoomTools(server, db);
registerInviteTools(server, db);
registerMessagingTools(server, db);
registerWaitTool(server, db);
registerReactionTools(server, db);
registerFollowTools(server, db);

// Register MCP resources
registerResources(server, db);

// Register MCP prompt templates
registerPrompts(server);

// Connect via stdio
async function main(): Promise<void> {
  // Auto-register agent on startup
  const dbInstance = getDatabase();
  const agent = resolveAgentId(dbInstance);
  console.error(`Flock MCP agent: ${agent.name} (${agent.id})`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Flock MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
