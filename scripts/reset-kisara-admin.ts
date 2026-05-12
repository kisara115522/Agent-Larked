import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createDatabase } from '@flock/server/db';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.DB_PATH ?? join(REPO_ROOT, 'data', 'agentfeed.db');
const TOKEN_PATH = process.env.TOKEN_PATH ?? join(dirname(DB_PATH), 'kisara-token.txt');

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function resetKisara(db: Database.Database): { id: string; token: string; created: boolean } {
  const now = new Date().toISOString();
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const existing = db.prepare('SELECT id FROM profiles WHERE name = ?').get('kisara') as { id: string } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE profiles
      SET display_name = COALESCE(NULLIF(display_name, ''), 'kisara'),
          token_hash = ?,
          is_admin = 1,
          updated_at = ?
      WHERE id = ?
    `).run(tokenHash, now, existing.id);
    return { id: existing.id, token, created: false };
  }

  const id = randomBytes(16).toString('hex');
  db.prepare(`
    INSERT INTO profiles (
      id,
      name,
      display_name,
      token_hash,
      status,
      is_admin,
      created_at,
      updated_at
    ) VALUES (?, 'kisara', 'kisara', ?, 'offline', 1, ?, ?)
  `).run(id, tokenHash, now, now);
  return { id, token, created: true };
}

function main(): void {
  const db = createDatabase(DB_PATH);
  try {
    const result = resetKisara(db);
    mkdirSync(dirname(TOKEN_PATH), { recursive: true });
    writeFileSync(TOKEN_PATH, `${result.token}\n`, { encoding: 'utf-8', mode: 0o600 });

    console.log(`${result.created ? 'Created' : 'Updated'} admin agent kisara`);
    console.log(`id: ${result.id}`);
    console.log(`db: ${DB_PATH}`);
    console.log(`token_file: ${TOKEN_PATH}`);
    console.log(`token: ${result.token}`);
  } finally {
    db.close();
  }
}

main();
