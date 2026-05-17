#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getAgentId, getDatabase, resolveAgentId, setAgentOffline, setAgentId } from './db.js';
import { createMcpServer } from './factory.js';
import { startMentionListener } from './mentions.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';

const db = getDatabase();

const server = createMcpServer({
  db,
  agentIdProvider: getAgentId,
  setAgentIdFn: setAgentId,
  enableMentionInjection: true,
  enableMentionListener: false,
});

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
  const mentionListener = startMentionListener(dbInstance, getAgentId);

  // NOTE: MCP startup does NOT set agent online.
  // Online/offline is controlled by host turn lifecycle hooks (PostToolUse → online, Stop → offline).
  // Process exit is a safety fallback only.

  // Set agent offline on process exit (safety net)
  const goOffline = () => {
    mentionListener.stop();
    setAgentOffline(dbInstance);
  };
  process.on('SIGINT', () => { goOffline(); process.exit(0); });
  process.on('SIGTERM', () => { goOffline(); process.exit(0); });
  process.on('exit', goOffline);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Flock MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
