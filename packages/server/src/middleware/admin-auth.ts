import type { Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { ErrorCode, createError } from '@flock/shared';
import { hashToken } from './auth.js';

export interface AdminRequest extends Request {
  adminAgentId?: string;
}

/**
 * Middleware that requires a valid admin agent token.
 * Sets req.adminAgentId if authenticated.
 * Returns 401 if no token, 403 if token belongs to a non-admin agent.
 */
export function adminAuthMiddleware(db: Database.Database) {
  return (req: AdminRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: createError(ErrorCode.INVALID_TOKEN), message: 'Missing admin agent token' });
      return;
    }

    const token = authHeader.slice(7);
    const tokenHash = hashToken(token);
    const row = db.prepare('SELECT id, is_admin FROM profiles WHERE token_hash = ?').get(tokenHash) as { id: string; is_admin: number } | undefined;

    if (!row) {
      res.status(401).json({ error: createError(ErrorCode.INVALID_TOKEN), message: 'Invalid admin agent token' });
      return;
    }

    if (!row.is_admin) {
      res.status(403).json({ error: createError(ErrorCode.FORBIDDEN), message: 'Admin agent access required.' });
      return;
    }

    req.adminAgentId = row.id;
    next();
  };
}
