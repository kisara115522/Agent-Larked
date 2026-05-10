import type { Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { ErrorCode, createError } from '@flock/shared';
import { verifyAdminToken } from '../services/human-user.js';

export interface AdminRequest extends Request {
  adminUserId?: string;
}

/**
 * Middleware that requires a valid human admin token.
 * Sets req.adminUserId if authenticated.
 * Returns 401 if no token, 403 if token is not an admin.
 */
export function adminAuthMiddleware(db: Database.Database) {
  return (req: AdminRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: createError(ErrorCode.INVALID_TOKEN), message: 'Missing human admin token' });
      return;
    }

    const adminUserId = verifyAdminToken(db, authHeader);
    if (!adminUserId) {
      // Token was provided but doesn't match a human admin
      // Check if it's a valid agent token (agent trying to access admin endpoint)
      res.status(403).json({ error: createError(ErrorCode.FORBIDDEN), message: 'Human admin access required. Agent tokens cannot perform management operations.' });
      return;
    }

    req.adminUserId = adminUserId;
    next();
  };
}

/**
 * Combined middleware: accepts EITHER human admin OR agent token.
 * Sets req.adminUserId (if admin) OR req.agentId (if agent).
 * Admin gets full access; agent gets limited access.
 */
export function adminOrAgentMiddleware(db: Database.Database) {
  const stmt = db.prepare('SELECT id FROM human_users WHERE token_hash = ?');
  const agentStmt = db.prepare('SELECT id FROM profiles WHERE token_hash = ?');

  return (req: AdminRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: createError(ErrorCode.INVALID_TOKEN) });
      return;
    }

    const token = authHeader.slice(7);
    const { createHash } = require('node:crypto');
    const hash = createHash('sha256').update(token).digest('hex');

    // Check human admin first
    const adminRow = stmt.get(hash) as { id: string } | undefined;
    if (adminRow) {
      req.adminUserId = adminRow.id;
      next();
      return;
    }

    // Then check agent
    const agentRow = agentStmt.get(hash) as { id: string } | undefined;
    if (agentRow) {
      (req as any).agentId = agentRow.id;
      next();
      return;
    }

    res.status(401).json({ error: createError(ErrorCode.INVALID_TOKEN) });
  };
}
