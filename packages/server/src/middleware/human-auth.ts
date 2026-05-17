import type { Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { ErrorCode, createError } from '@flock/shared';

export interface HumanAuthenticatedRequest extends Request {
  humanId?: string;
}

export function humanAuthMiddleware(db: Database.Database) {
  const stmt = db.prepare(`
    SELECT h.id FROM human_sessions hs
    JOIN humans h ON h.id = hs.human_id
    WHERE hs.token = ? AND hs.expires_at > datetime('now')
  `);

  return (req: HumanAuthenticatedRequest, res: Response, next: NextFunction): void => {
    // Check cookie first, then Authorization header
    const token = req.cookies?.flock_session || extractBearerToken(req);

    if (!token) {
      res.status(401).json({ error: createError(ErrorCode.INVALID_TOKEN) });
      return;
    }

    const row = stmt.get(token) as { id: string } | undefined;

    if (!row) {
      res.status(401).json({ error: createError(ErrorCode.INVALID_TOKEN) });
      return;
    }

    req.humanId = row.id;
    next();
  };
}

function extractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return undefined;
}
