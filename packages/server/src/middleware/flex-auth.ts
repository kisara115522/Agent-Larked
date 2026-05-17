import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { ErrorCode, createError } from '@flock/shared';

export interface FlexAuthenticatedRequest extends Request {
  agentId?: string;
}

/**
 * Flex auth middleware: tries agent token (Bearer → profiles.token_hash) first,
 * then falls back to human session token (Bearer → human_sessions).
 * Sets req.agentId to the profile ID in either case.
 */
export function flexAuthMiddleware(db: Database.Database) {
  const agentStmt = db.prepare('SELECT id FROM profiles WHERE token_hash = ?');
  const humanStmt = db.prepare(`
    SELECT h.id FROM human_sessions hs
    JOIN humans h ON h.id = hs.human_id
    WHERE hs.token = ? AND hs.expires_at > datetime('now')
  `);

  return (req: FlexAuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      // Also check query param (for SSE)
      const queryToken = req.query.token as string | undefined;
      if (queryToken) {
        const result = resolveToken(queryToken, agentStmt, humanStmt);
        if (result) {
          req.agentId = result;
          next();
          return;
        }
      }
      res.status(401).json({ error: createError(ErrorCode.INVALID_TOKEN) });
      return;
    }

    const token = authHeader.slice(7);
    const result = resolveToken(token, agentStmt, humanStmt);

    if (!result) {
      res.status(401).json({ error: createError(ErrorCode.INVALID_TOKEN) });
      return;
    }

    req.agentId = result;
    next();
  };
}

function resolveToken(
  token: string,
  agentStmt: import('better-sqlite3').Statement,
  humanStmt: import('better-sqlite3').Statement,
): string | null {
  // Try agent token first
  const hash = createHash('sha256').update(token).digest('hex');
  const agentRow = agentStmt.get(hash) as { id: string } | undefined;
  if (agentRow) return agentRow.id;

  // Fall back to human session token
  const humanRow = humanStmt.get(token) as { id: string } | undefined;
  if (humanRow) return humanRow.id;

  return null;
}
