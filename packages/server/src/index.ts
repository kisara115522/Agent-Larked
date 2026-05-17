import express from 'express';
import cookieParser from 'cookie-parser';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, cleanupIdempotencyKeys } from './db.js';
import { errorHandler } from './middleware/error.js';
import { EventBus } from './sse/event-bus.js';
import { agentsRouter } from './routes/agents.js';
import { roomsRouter } from './routes/rooms.js';
import { messagesRouter } from './routes/messages.js';
import { reactionsRouter } from './routes/reactions.js';
import { eventsRouter } from './routes/events.js';
import { directChatsRouter } from './routes/direct-chats.js';
import { humanAuthRouter } from './routes/human-auth.js';
import { runtimesRouter } from './routes/runtimes.js';
import { tasksRouter } from './routes/tasks.js';
import { configsRouter } from './routes/configs.js';
import { bootstrapDefaultAgent } from './db.js';
import { hashToken } from './middleware/auth.js';

export function createApp(dbPath: string = ':memory:'): { app: express.Express; db: ReturnType<typeof createDatabase> } {
  const db = createDatabase(dbPath);
  const eventBus = new EventBus();

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // Routes
  app.use('/human', humanAuthRouter(db));
  app.use('/agents', agentsRouter(db, eventBus));
  app.use('/runtimes', runtimesRouter(db));
  app.use('/tasks', tasksRouter(db, eventBus));
  app.use('/', configsRouter(db));
  app.use('/rooms', roomsRouter(db, eventBus));
  app.use('/messages', messagesRouter(db, eventBus));
  app.use('/direct-chats', directChatsRouter(db, eventBus));
  app.use('/messages', reactionsRouter(db, eventBus));
  app.use('/events', eventsRouter(db, eventBus));

  // Error handler (must be last)
  app.use(errorHandler);

  // Start DB poller for cross-process SSE bridge (MCP writes to DB, poller pushes to SSE)
  eventBus.startPolling(db, 2000);

  return { app, db };
}

// Start server when run directly (not when imported by tests)
const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMainModule) {
  const port = Number(process.env.PORT ?? 3000);
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const dbPath = process.env.DB_PATH ?? join(repoRoot, 'data', 'agentfeed.db');
  const { app, db } = createApp(dbPath);

  // Bootstrap default agent 'kisara' if it does not exist
  const kisaraToken = bootstrapDefaultAgent(db, hashToken);
  if (kisaraToken) {
    const tokenFile = join(dirname(dbPath), 'kisara-token.txt');
    mkdirSync(dirname(tokenFile), { recursive: true });
    writeFileSync(tokenFile, kisaraToken, { encoding: 'utf-8', mode: 0o600 });
    console.log(`Default agent 'kisara' created. Token saved to ${tokenFile}`);
  }

  // Idempotency key cleanup every hour
  setInterval(() => cleanupIdempotencyKeys(db), 60 * 60 * 1000);

  app.listen(port, () => {
    console.log(`AgentFeed server listening on :${port}`);
  });
}
