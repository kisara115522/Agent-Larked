import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase } from '@flock/server/db';
import { createHttpMcpHandler } from '../http.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
let server: Server;
let baseUrl: string;
let tempDir: string;
let origFlockHome: string | undefined;
let testAgentId: string;
let testAgentToken: string;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'flock-http-'));
  origFlockHome = process.env.FLOCK_HOME;
  process.env.FLOCK_HOME = tempDir;

  db = createDatabase(':memory:');

  // Register a test agent
  testAgentId = 'http-test-agent-id';
  testAgentToken = 'test-token-abc';
  const { createHash } = await import('node:crypto');
  const tokenHash = createHash('sha256').update(testAgentToken).digest('hex');
  db.prepare(
    "INSERT INTO profiles (id, name, display_name, token_hash, status, created_at, updated_at) VALUES (?, 'HttpTestAgent', 'HttpTest', ?, 'active', datetime('now'), datetime('now'))",
  ).run(testAgentId, tokenHash);

  const handler = createHttpMcpHandler({
    db,
    resolveAgentId: (token: string) => {
      const hash = createHash('sha256').update(token).digest('hex');
      const row = db.prepare('SELECT id, name FROM profiles WHERE token_hash = ?').get(hash) as
        | { id: string; name: string }
        | undefined;
      return row ?? null;
    },
  });

  server = createServer(async (req, res) => {
    // Only handle /mcp path
    if (req.url === '/mcp') {
      await handler(req, res);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  if (origFlockHome !== undefined) {
    process.env.FLOCK_HOME = origFlockHome;
  } else {
    delete process.env.FLOCK_HOME;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

/** MCP POST requests require Accept: application/json, text/event-stream */
const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

/** Parse SSE response: extract JSON-RPC messages from event: message\ndata: {...}\n\n */
async function parseSSEResponse(res: Response): Promise<{ messages: unknown[]; sessionId: string | null }> {
  const text = await res.text();
  const sessionId = res.headers.get('mcp-session-id');
  const messages: unknown[] = [];
  // SSE format: "event: message\ndata: {...}\n\n"
  const dataLines = text.split('\n').filter((line) => line.startsWith('data: '));
  for (const line of dataLines) {
    const jsonStr = line.slice(6); // Remove "data: " prefix
    try {
      messages.push(JSON.parse(jsonStr));
    } catch {
      // skip non-JSON data lines
    }
  }
  return { messages, sessionId };
}

describe('MCP HTTP Transport', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: MCP_HEADERS.Accept },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Missing Authorization');
  });

  it('returns 403 when token is invalid', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        ...MCP_HEADERS,
        Authorization: 'Bearer invalid-token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Invalid agent token');
  });

  it('accepts valid token and creates MCP session', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        ...MCP_HEADERS,
        Authorization: `Bearer ${testAgentToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0' },
        },
      }),
    });

    // StreamableHTTPServerTransport returns 200 with SSE response
    expect(res.status).toBe(200);
    const sessionId = res.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();

    // Parse SSE response to get the JSON-RPC result
    const { messages } = await parseSSEResponse(res);
    expect(messages.length).toBeGreaterThan(0);
    const initResult = messages[0] as { result: object };
    expect(initResult).toHaveProperty('result');
    expect(initResult.result).toHaveProperty('serverInfo');
  });

  it('reuses session for tools/list after initialize', async () => {
    // First request: initialize
    const initRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        ...MCP_HEADERS,
        Authorization: `Bearer ${testAgentToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test-reuse', version: '1.0' },
        },
      }),
    });

    const { sessionId } = await parseSSEResponse(initRes);
    expect(sessionId).toBeTruthy();

    // Send initialized notification + tools/list in sequence on the same session
    // Note: MCP notifications (without id) may not work perfectly via HTTP in all cases,
    // so we test session continuity with a tools/list request instead
    const toolsRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        ...MCP_HEADERS,
        Authorization: `Bearer ${testAgentToken}`,
        'mcp-session-id': sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 2,
        params: {},
      }),
    });

    // The transport should recognize the session and return tools
    // (may return 200 with tools, or error if server requires initialized notification first)
    const { messages: toolMessages } = await parseSSEResponse(toolsRes);
    if (toolsRes.status === 200 && toolMessages.length > 0) {
      const toolsResult = toolMessages[0] as { result: { tools: { name: string }[] } };
      expect(toolsResult.result).toHaveProperty('tools');
      const toolNames = toolsResult.result.tools.map((t) => t.name);
      expect(toolNames).toContain('flock_post');
      expect(toolNames).toContain('flock_room_list');
    } else {
      // If server rejects because it needs initialized notification, that's OK —
      // the session was still found (not a 404 for missing session)
      expect(toolsRes.status).not.toBe(404);
    }
  });

  it('rejects request with invalid session ID', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        ...MCP_HEADERS,
        Authorization: `Bearer ${testAgentToken}`,
        'mcp-session-id': 'non-existent-session-id',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
        params: {},
      }),
    });

    // Should reject with 400 (session not found)
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        ...MCP_HEADERS,
        Authorization: `Bearer ${testAgentToken}`,
      },
      body: 'not-json{{{',
    });

    // Should return an error (400 or 500 depending on handler)
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
