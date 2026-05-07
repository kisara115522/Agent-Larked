export enum ErrorCode {
  AGENT_NOT_FOUND = 1001,
  ROOM_NOT_FOUND = 1002,
  NOT_ROOM_MEMBER = 1003,
  MESSAGE_TOO_LARGE = 1004,
  DUPLICATE_REACTION = 1005,
  INVALID_TOKEN = 1006,
  ROOM_ALREADY_EXISTS = 1007,
  VALIDATION_ERROR = 1008,
  CROSS_ROOM_REPLY = 1009,
  THREAD_CYCLE = 1010,
  IDEMPOTENCY_CONFLICT = 1011,
  CANNOT_BROADCAST_TO_SELF = 1012,
}

export interface AppError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export interface ErrorResponse {
  error: AppError;
}

const ERROR_MESSAGES: Record<ErrorCode, { message: string; retryable: boolean }> = {
  [ErrorCode.AGENT_NOT_FOUND]: { message: 'Agent not found', retryable: false },
  [ErrorCode.ROOM_NOT_FOUND]: { message: 'Room not found', retryable: false },
  [ErrorCode.NOT_ROOM_MEMBER]: { message: 'Not a member of this room', retryable: false },
  [ErrorCode.MESSAGE_TOO_LARGE]: { message: 'Message exceeds 1MB limit', retryable: false },
  [ErrorCode.DUPLICATE_REACTION]: { message: 'Duplicate reaction', retryable: false },
  [ErrorCode.INVALID_TOKEN]: { message: 'Invalid or missing token', retryable: false },
  [ErrorCode.ROOM_ALREADY_EXISTS]: { message: 'Room already exists', retryable: false },
  [ErrorCode.VALIDATION_ERROR]: { message: 'Validation error', retryable: false },
  [ErrorCode.CROSS_ROOM_REPLY]: { message: 'Cross-room reply not allowed', retryable: false },
  [ErrorCode.THREAD_CYCLE]: { message: 'Thread reply would create a cycle', retryable: false },
  [ErrorCode.IDEMPOTENCY_CONFLICT]: { message: 'Idempotency key conflict', retryable: false },
  [ErrorCode.CANNOT_BROADCAST_TO_SELF]: { message: 'Cannot broadcast to self', retryable: false },
};

export function createError(code: ErrorCode): AppError {
  const { message, retryable } = ERROR_MESSAGES[code];
  return { code, message, retryable };
}
