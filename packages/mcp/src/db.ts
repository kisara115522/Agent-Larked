import { createDatabase, cleanupIdempotencyKeys } from '@flock/server/db';
import type Database from 'better-sqlite3';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = process.env.DB_PATH ?? './data/agentfeed.db';
    db = createDatabase(dbPath);
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
