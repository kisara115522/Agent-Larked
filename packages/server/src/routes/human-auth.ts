import { Router } from 'express';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ErrorCode, createError } from '@flock/shared';
import { humanAuthMiddleware, type HumanAuthenticatedRequest } from '../middleware/human-auth.js';

export function humanAuthRouter(db: Database.Database): Router {
  const router = Router();

  // POST /human/register
  router.post('/register', (req, res) => {
    const { username, password, display_name } = req.body;

    if (!username || typeof username !== 'string' || username.length < 2) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Username must be at least 2 characters' } });
      return;
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 6 characters' } });
      return;
    }

    // Check if username exists
    const existing = db.prepare('SELECT id FROM humans WHERE username = ?').get(username);
    if (existing) {
      res.status(409).json({ error: { code: 'DUPLICATE', message: 'Username already taken' } });
      return;
    }

    const now = new Date().toISOString();
    const id = randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password);
    const sessionToken = randomBytes(32).toString('hex');
    const sessionId = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    db.transaction(() => {
      db.prepare(`
        INSERT INTO humans (id, username, password_hash, display_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, username, passwordHash, display_name || username, now, now);

      // Create a profile entry so human can send messages (FK from_agent requires it)
      db.prepare(`
        INSERT OR IGNORE INTO profiles (id, name, display_name, token_hash, status, created_at, updated_at)
        VALUES (?, ?, ?, 'human-no-login', 'active', ?, ?)
      `).run(id, username, display_name || username, now, now);

      db.prepare(`
        INSERT INTO human_sessions (id, human_id, token, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(sessionId, id, sessionToken, expiresAt, now);
    })();

    // Set cookie
    res.cookie('flock_session', sessionToken, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'lax',
    });

    res.status(201).json({ id, token: sessionToken });
  });

  // POST /human/login
  router.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Username and password required' } });
      return;
    }

    const human = db.prepare('SELECT id, password_hash, display_name FROM humans WHERE username = ?').get(username) as {
      id: string;
      password_hash: string;
      display_name: string;
    } | undefined;

    if (!human || !verifyPassword(password, human.password_hash)) {
      res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } });
      return;
    }

    const now = new Date().toISOString();
    const sessionToken = randomBytes(32).toString('hex');
    const sessionId = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO human_sessions (id, human_id, token, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, human.id, sessionToken, expiresAt, now);

    res.cookie('flock_session', sessionToken, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });

    res.json({ id: human.id, token: sessionToken });
  });

  // GET /human/me
  router.get('/me', humanAuthMiddleware(db), (req: HumanAuthenticatedRequest, res) => {
    const human = db.prepare('SELECT id, username, display_name, created_at FROM humans WHERE id = ?').get(req.humanId) as {
      id: string;
      username: string;
      display_name: string;
      created_at: string;
    } | undefined;

    if (!human) {
      res.status(404).json({ error: createError(ErrorCode.NOT_FOUND) });
      return;
    }

    res.json(human);
  });

  return router;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(hash, 'hex');
  return timingSafeEqual(derived, storedBuf);
}
