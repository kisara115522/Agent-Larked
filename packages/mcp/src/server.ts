#!/usr/bin/env node
/**
 * Standalone MCP HTTP Server
 *
 * Runs the Flock MCP tools over Streamable HTTP transport.
 * Remote agents connect via: http://host:port/mcp
 *
 * Usage:
 *   MCP_PORT=3001 DB_PATH=./data/agentfeed.db node dist/server.js
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createHttpMcpHandler } from './http.js';
import { getDatabase, closeDatabase } from './db.js';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const port = Number(process.env.MCP_PORT ?? 3001);
const db = getDatabase();

function resolveAgentId(token: string): { id: string; name: string } | null {
  const hashed = hashToken(token);
  const row = db.prepare('SELECT id, name FROM profiles WHERE token_hash = ?').get(hashed) as
    | { id: string; name: string }
    | undefined;
  return row ?? null;
}

const handler = createHttpMcpHandler({ db, resolveAgentId });

const server = createServer(async (req, res) => {
  // CORS headers for cross-machine access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id');
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Route all /mcp requests to the handler
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  if (url.pathname === '/mcp' || url.pathname === '/mcp/') {
    await handler(req, res);
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use /mcp endpoint.' }));
  }
});

server.listen(port, () => {
  console.log(`Flock MCP HTTP server listening on :${port}/mcp`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down MCP HTTP server...');
  closeDatabase();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDatabase();
  server.close();
  process.exit(0);
});
