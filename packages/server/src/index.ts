import express from 'express';
import { createDatabase, cleanupIdempotencyKeys } from './db.js';
import { errorHandler } from './middleware/error.js';
import { EventBus } from './sse/event-bus.js';
import { agentsRouter } from './routes/agents.js';
import { followsRouter } from './routes/follows.js';
import { agentInvitesRouter, invitesActionsRouter } from './routes/invites.js';
import { broadcastRouter, feedRouter } from './routes/broadcast.js';
import { roomsRouter } from './routes/rooms.js';
import { messagesRouter } from './routes/messages.js';
import { reactionsRouter } from './routes/reactions.js';
import { eventsRouter } from './routes/events.js';
import { authRouter } from './routes/auth.js';
import { directChatsRouter } from './routes/direct-chats.js';

export function createApp(dbPath: string = ':memory:'): { app: express.Express; db: ReturnType<typeof createDatabase> } {
  const db = createDatabase(dbPath);
  const eventBus = new EventBus();

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Routes
  app.use('/auth', authRouter(db));
  app.use('/agents', agentsRouter(db, eventBus));
  app.use('/agents', followsRouter(db));
  app.use('/agents', agentInvitesRouter(db));
  app.use('/invites', invitesActionsRouter(db));
  app.use('/rooms', roomsRouter(db, eventBus));
  app.use('/messages', messagesRouter(db, eventBus));
  app.use('/direct-chats', directChatsRouter(db, eventBus));
  app.use('/messages', reactionsRouter(db, eventBus));
  app.use('/events', eventsRouter(db, eventBus));
  app.use('/broadcast', broadcastRouter(db, eventBus));
  app.use('/feed', feedRouter(db));

  // Error handler (must be last)
  app.use(errorHandler);

  return { app, db };
}

// Start server when run directly (not when imported by tests)
const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMainModule) {
  const port = Number(process.env.PORT ?? 3000);
  const defaultDbPath = './data/agentfeed.db';
  const { app, db } = createApp(process.env.DB_PATH ?? defaultDbPath);

  // Idempotency key cleanup every hour
  setInterval(() => cleanupIdempotencyKeys(db), 60 * 60 * 1000);

  app.listen(port, () => {
    console.log(`AgentFeed server listening on :${port}`);
  });
}
