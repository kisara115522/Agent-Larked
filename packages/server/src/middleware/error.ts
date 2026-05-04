import type { Request, Response, NextFunction } from 'express';
import { ErrorCode, createError } from '@lark/shared';

export class ServerError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable: boolean = false,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ServerError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        retryable: err.retryable,
      },
    });
    return;
  }

  console.error('Unhandled error:', err);
  res.status(500).json({
    error: { code: 0, message: 'Internal server error', retryable: false },
  });
}
