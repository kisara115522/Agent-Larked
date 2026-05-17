import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type Database from 'better-sqlite3';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './factory.js';

export interface HttpMcpHandlerOptions {
  db: Database.Database;
  resolveAgentId: (token: string) => { id: string; name: string } | null;
}

/**
 * Create an Express-compatible handler for the MCP Streamable HTTP endpoint.
 *
 * Usage:
 *   const handler = createHttpMcpHandler({ db, resolveAgentId });
 *   app.all('/mcp', handler);
 */
export function createHttpMcpHandler(options: HttpMcpHandlerOptions) {
  const { db, resolveAgentId } = options;

  const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 minutes

  // Store transports by session ID for stateful mode
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const lastActivity = new Map<string, number>();

  // Periodic cleanup of idle sessions
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, activity] of lastActivity) {
      if (now - activity > SESSION_IDLE_MS) {
        const transport = transports.get(sessionId);
        if (transport) {
          transport.close();
          transports.delete(sessionId);
        }
        lastActivity.delete(sessionId);
      }
    }
  }, 60_000); // Check every minute

  // Prevent the timer from keeping the process alive
  if (cleanupInterval.unref) cleanupInterval.unref();

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Extract Bearer token from Authorization header
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing Authorization: Bearer <token>' }));
      return;
    }

    const agent = resolveAgentId(token);
    if (!agent) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid agent token' }));
      return;
    }

    // Parse body for POST requests
    let parsedBody: unknown = undefined;
    if (req.method === 'POST') {
      try {
        parsedBody = await new Promise((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => {
            try {
              const raw = Buffer.concat(chunks).toString('utf-8');
              resolve(raw ? JSON.parse(raw) : undefined);
            } catch (err) {
              reject(err);
            }
          });
          req.on('error', reject);
        });
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }
    }

    // Check for existing session ID
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    let transport = sessionId ? transports.get(sessionId) : undefined;

    // Update activity timestamp for existing sessions
    if (transport && sessionId) {
      lastActivity.set(sessionId, Date.now());
    }

    if (!transport) {
      // Create new transport for this session
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      // Create MCP server with the agent's identity
      const agentIdProvider = () => agent.id;
      const server = createMcpServer({
        db,
        agentIdProvider,
        enableMentionInjection: true,
        enableMentionListener: false,
        name: 'flock-http',
        version: '0.1.0',
      });

      await server.connect(transport);

      // Store transport by session ID
      if (transport.sessionId) {
        transports.set(transport.sessionId, transport);
        lastActivity.set(transport.sessionId, Date.now());

        // Clean up on close
        transport.onclose = () => {
          if (transport?.sessionId) {
            transports.delete(transport.sessionId);
            lastActivity.delete(transport.sessionId);
          }
        };
      }
    }

    // Handle the request
    await transport.handleRequest(req, res, parsedBody);
  };
}
