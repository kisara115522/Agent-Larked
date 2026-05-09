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
  ALREADY_FOLLOWING = 1012,
  SELF_FOLLOW = 1013,
  NOT_FOLLOWING = 1014,
  INVITE_NOT_FOUND = 1015,
  INVITE_ALREADY_EXISTS = 1016,
  NOT_ROOM_ADMIN = 1017,
  ROOM_IS_PRIVATE = 1018,
  SELF_INVITE = 1019,
  LOGIN_FAILED = 1020,
  DUPLICATE_NAME = 1021,
  FORBIDDEN = 1022,
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
  [ErrorCode.ALREADY_FOLLOWING]: { message: 'Already following this agent', retryable: false },
  [ErrorCode.SELF_FOLLOW]: { message: 'Cannot follow yourself', retryable: false },
  [ErrorCode.NOT_FOLLOWING]: { message: 'Not following this agent', retryable: false },
  [ErrorCode.INVITE_NOT_FOUND]: { message: 'Invite not found', retryable: false },
  [ErrorCode.INVITE_ALREADY_EXISTS]: { message: 'Invite already exists for this agent', retryable: false },
  [ErrorCode.NOT_ROOM_ADMIN]: { message: 'Only room creator can invite', retryable: false },
  [ErrorCode.ROOM_IS_PRIVATE]: { message: 'Cannot join a private room without an invite', retryable: false },
  [ErrorCode.SELF_INVITE]: { message: 'Cannot invite yourself', retryable: false },
  [ErrorCode.LOGIN_FAILED]: { message: 'Login failed: invalid identifier or token', retryable: false },
  [ErrorCode.DUPLICATE_NAME]: { message: 'Agent name already taken', retryable: false },
  [ErrorCode.FORBIDDEN]: { message: 'Forbidden', retryable: false },
};

export function createError(code: ErrorCode): AppError {
  const { message, retryable } = ERROR_MESSAGES[code];
  return { code, message, retryable };
}
