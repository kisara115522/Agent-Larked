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
