import express from 'express';
import { createDatabase } from './db.js';
import { errorHandler } from './middleware/error.js';
import { EventBus } from './sse/event-bus.js';
import { agentsRouter } from './routes/agents.js';
import { roomsRouter } from './routes/rooms.js';
import { messagesRouter } from './routes/messages.js';
import { reactionsRouter } from './routes/reactions.js';
import { eventsRouter } from './routes/events.js';

export function createApp(dbPath: string = ':memory:'): express.Express {
  const db = createDatabase(dbPath);
  const eventBus = new EventBus();

  const app = express();
  app.use(express.json());

  // Routes
  app.use('/agents', agentsRouter(db));
  app.use('/rooms', roomsRouter(db));
  app.use('/messages', messagesRouter(db, eventBus));
  app.use('/messages', reactionsRouter(db, eventBus));
  app.use('/events', eventsRouter(db, eventBus));

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}

// Start server when run directly
const port = Number(process.env.PORT ?? 3000);
const app = createApp(process.env.DB_PATH);

app.listen(port, () => {
  console.log(`AgentFeed server listening on :${port}`);
});
