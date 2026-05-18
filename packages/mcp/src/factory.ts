import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { registerIdentityTools } from './tools/identity.js';
import { registerRoomTools } from './tools/room.js';
import { registerMessagingTools } from './tools/messaging.js';
import { registerDirectChatTools } from './tools/direct-chat.js';
import { registerMentionTools } from './tools/mentions.js';
import { registerWaitTool } from './tools/subscribe.js';
import { registerReactionTools } from './tools/reactions.js';
import { registerAgentLifecycleTools } from './tools/agent-lifecycle.js';
import { registerTaskTools } from './tools/task.js';
import { installUnreadMentionInjection, startMentionListener } from './mentions.js';
import { getAgentId } from './db.js';

export interface McpServerOptions {
  db: Database.Database;
  agentIdProvider?: () => string | null;
  setAgentIdFn?: (id: string, name: string) => void;
  name?: string;
  version?: string;
  enableMentionInjection?: boolean;
  enableMentionListener?: boolean;
}

/**
 * Create a Flock MCP server with all tools registered.
 * Can be used for both stdio (local) and HTTP (remote) modes.
 */
export function createMcpServer(options: McpServerOptions): McpServer {
  const {
    db,
    agentIdProvider = getAgentId,
    setAgentIdFn,
    name = 'flock',
    version = '0.1.0',
    enableMentionInjection = true,
    enableMentionListener = false,
  } = options;

  const server = new McpServer({ name, version });

  // Install mention injection wrapper (injects unread digest into every tool result)
  if (enableMentionInjection) {
    installUnreadMentionInjection(server, db, agentIdProvider);
  }

  // Register all tool groups
  registerIdentityTools(server, db, agentIdProvider, setAgentIdFn);
  registerRoomTools(server, db, agentIdProvider);
  registerMessagingTools(server, db, agentIdProvider);
  registerDirectChatTools(server, db, agentIdProvider);
  registerMentionTools(server, db, agentIdProvider);
  registerWaitTool(server, db, agentIdProvider);
  registerReactionTools(server, db, agentIdProvider);
  registerAgentLifecycleTools(server, db, agentIdProvider);
  registerTaskTools(server, db, agentIdProvider);

  // Start background mention listener (for long-running processes)
  if (enableMentionListener) {
    startMentionListener(db, agentIdProvider);
  }

  return server;
}
