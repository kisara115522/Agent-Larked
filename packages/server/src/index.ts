import express from 'express';
import { createDatabase, cleanupIdempotencyKeys } from './db.js';
import { errorHandler } from './middleware/error.js';
import { EventBus } from './sse/event-bus.js';
import { agentsRouter } from './routes/agents.js';
import { roomsRouter } from './routes/rooms.js';
import { messagesRouter } from './routes/messages.js';
import { reactionsRouter } from './routes/reactions.js';
import { eventsRouter } from './routes/events.js';

export function createApp(dbPath: string = ':memory:'): { app: express.Express; db: ReturnType<typeof createDatabase> } {
  const db = createDatabase(dbPath);
  const eventBus = new EventBus();

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Routes
  app.use('/agents', agentsRouter(db));
  app.use('/rooms', roomsRouter(db, eventBus));
  app.use('/messages', messagesRouter(db, eventBus));
  app.use('/messages', reactionsRouter(db, eventBus));
  app.use('/events', eventsRouter(db, eventBus));

  // Error handler (must be last)
  app.use(errorHandler);

  return { app, db };
}

// Start server when run directly
const port = Number(process.env.PORT ?? 3000);
const { app, db } = createApp(process.env.DB_PATH);

// Idempotency key cleanup every hour
setInterval(() => cleanupIdempotencyKeys(db), 60 * 60 * 1000);

app.listen(port, () => {
  console.log(`AgentFeed server listening on :${port}`);
});
