import { describe, expect, it } from 'vitest';
import { createDatabase, cleanupIdempotencyKeys } from '../db.js';

describe('idempotency cleanup', () => {
  it('removes expired room and direct idempotency keys', () => {
    const db = createDatabase(':memory:');
    try {
      db.prepare(`
        INSERT INTO profiles (id, name, token_hash, created_at, updated_at)
        VALUES ('agent-1', 'CleanupAgent1', 'hash-1', '2026-05-09T00:00:00.000Z', '2026-05-09T00:00:00.000Z')
      `).run();
      db.prepare(`
        INSERT INTO profiles (id, name, token_hash, created_at, updated_at)
        VALUES ('agent-2', 'CleanupAgent2', 'hash-2', '2026-05-09T00:00:00.000Z', '2026-05-09T00:00:00.000Z')
      `).run();

      db.prepare(`
        INSERT INTO idempotency_keys (agent_id, key, request_hash, response, expires_at)
        VALUES ('agent-1', 'old-room', 'hash', '{}', '2000-01-01T00:00:00.000Z')
      `).run();
      db.prepare(`
        INSERT INTO direct_idempotency_keys (agent_id, peer_id, key, request_hash, response, expires_at)
        VALUES ('agent-1', 'agent-2', 'old-direct', 'hash', '{}', '2000-01-01T00:00:00.000Z')
      `).run();

      const removed = cleanupIdempotencyKeys(db);

      expect(removed).toBe(2);
      expect((db.prepare('SELECT COUNT(*) AS count FROM idempotency_keys').get() as { count: number }).count).toBe(0);
      expect((db.prepare('SELECT COUNT(*) AS count FROM direct_idempotency_keys').get() as { count: number }).count).toBe(0);
    } finally {
      db.close();
    }
  });
});
