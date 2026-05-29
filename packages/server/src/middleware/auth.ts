import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { ErrorCode, createError } from '@flock/shared';

export interface AuthenticatedRequest extends Request {
  agentId?: string;
}

export function authMiddleware(db: Database.Database) {
  const stmt = db.prepare('SELECT id FROM profiles WHERE token_hash = ?');

  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: createError(ErrorCode.INVALID_TOKEN) });
      return;
    }

    const token = authHeader.slice(7);
    const hash = createHash('sha256').update(token).digest('hex');
    const row = stmt.get(hash) as { id: string; token_hash: string } | undefined;

    if (!row) {
      res.status(401).json({ error: createError(ErrorCode.INVALID_TOKEN) });
      return;
    }

    req.agentId = row.id;
    next();
  };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
