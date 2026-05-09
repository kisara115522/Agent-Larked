import { Router } from 'express';
import type Database from 'better-sqlite3';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';
import { hashToken } from '../middleware/auth.js';
import { rowToProfile } from '../services/profile-utils.js';
import type { LoginRequest, LoginResponse } from '@flock/shared';

export function authRouter(db: Database.Database): Router {
  const router = Router();

  // POST /auth/login — login by id or display_name + token
  router.post('/login', (req, res, next) => {
    try {
      const { identifier, token } = req.body as LoginRequest;

      if (!identifier || !token) {
        throw new ServerError(ErrorCode.VALIDATION_ERROR, 'identifier and token are required', false, 400);
      }

      const tokenHash = hashToken(token);

      // Try id first (exact match), then display_name (must be unique)
      let row = db.prepare(
        'SELECT * FROM profiles WHERE id = ? AND token_hash = ?',
      ).get(identifier, tokenHash) as Record<string, unknown> | undefined;

      if (!row) {
        // Try display_name — must match exactly one agent
        const candidates = db.prepare(
          'SELECT * FROM profiles WHERE display_name = ? AND token_hash = ?',
        ).all(identifier, tokenHash) as Record<string, unknown>[];

        if (candidates.length === 1) {
          row = candidates[0];
        } else if (candidates.length > 1) {
          throw new ServerError(
            ErrorCode.VALIDATION_ERROR,
            'Multiple agents share this display_name. Use agent id instead.',
            false,
            409,
          );
        }
      }

      if (!row) {
        throw new ServerError(ErrorCode.LOGIN_FAILED, 'Invalid identifier or token', false, 401);
      }

      const profile = rowToProfile(row);
      const response: LoginResponse = {
        id: profile.id,
        name: profile.name,
        display_name: profile.display_name,
        token, // return the original token (not hash)
      };

      res.json(response);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
