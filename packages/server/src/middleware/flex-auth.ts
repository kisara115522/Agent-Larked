import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { ErrorCode, createError } from '@flock/shared';

export interface FlexAuthenticatedRequest extends Request {
  agentId?: string;
  humanId?: string;
}

interface ResolvedToken {
  id: string;
  type: 'agent' | 'human';
}

/**
 * Flex auth middleware: tries agent token (Bearer → profiles.token_hash) first,
 * then falls back to human session token (Bearer → human_sessions).
 * Sets req.agentId for agents, req.humanId for humans.
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
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : req.cookies?.flock_session ?? (req.query.token as string | undefined);

    if (!token) {
      res.status(401).json({ error: createError(ErrorCode.INVALID_TOKEN) });
      return;
    }

    const result = resolveToken(token, agentStmt, humanStmt);

    if (!result) {
      res.status(401).json({ error: createError(ErrorCode.INVALID_TOKEN) });
      return;
    }

    applyResult(req, result);
    next();
  };
}

function applyResult(req: FlexAuthenticatedRequest, result: ResolvedToken): void {
  if (result.type === 'agent') {
    req.agentId = result.id;
  } else {
    req.humanId = result.id;
    // For backward compat, also set agentId so existing code that only checks agentId still works
    req.agentId = result.id;
  }
}

function resolveToken(
  token: string,
  agentStmt: import('better-sqlite3').Statement,
  humanStmt: import('better-sqlite3').Statement,
): ResolvedToken | null {
  // Try agent token first
  const hash = createHash('sha256').update(token).digest('hex');
  const agentRow = agentStmt.get(hash) as { id: string } | undefined;
  if (agentRow) return { id: agentRow.id, type: 'agent' };

  // Fall back to human session token
  const humanRow = humanStmt.get(token) as { id: string } | undefined;
  if (humanRow) return { id: humanRow.id, type: 'human' };

  return null;
}
