export enum ErrorCode {
  // General
  VALIDATION_ERROR = 1000,
  NOT_FOUND = 1001,
  FORBIDDEN = 1002,
  IDEMPOTENCY_CONFLICT = 1003,
  DUPLICATE_NAME = 1004,

  // Agent
  AGENT_NOT_FOUND = 1100,
  AGENT_ALREADY_SPAWNED = 1101,
  AGENT_NOT_SPAWNED = 1102,

  // Human Auth
  LOGIN_FAILED = 1200,
  USERNAME_TAKEN = 1201,
  SESSION_EXPIRED = 1202,

  // Room
  ROOM_NOT_FOUND = 1300,
  ROOM_ALREADY_EXISTS = 1301,
  NOT_ROOM_MEMBER = 1302,
  ROOM_IS_PRIVATE = 1303,

  // Message
  MESSAGE_TOO_LARGE = 1400,
  CROSS_ROOM_REPLY = 1401,
  THREAD_CYCLE = 1402,
  DUPLICATE_REACTION = 1403,

  // Task
  TASK_NOT_FOUND = 1500,
  INVALID_STATUS_TRANSITION = 1501,
  TASK_TERMINAL_STATE = 1502,
  TASK_MAX_RETRIES = 1503,

  // Runtime
  RUNTIME_NOT_FOUND = 1600,
  RUNTIME_OFFLINE = 1601,

  // Token
  TOKEN_BUDGET_EXCEEDED = 1700,
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
  // General
  [ErrorCode.VALIDATION_ERROR]: { message: 'Validation error', retryable: false },
  [ErrorCode.NOT_FOUND]: { message: 'Resource not found', retryable: false },
  [ErrorCode.FORBIDDEN]: { message: 'Forbidden', retryable: false },
  [ErrorCode.IDEMPOTENCY_CONFLICT]: { message: 'Idempotency key conflict', retryable: false },
  [ErrorCode.DUPLICATE_NAME]: { message: 'Name already taken', retryable: false },

  // Agent
  [ErrorCode.AGENT_NOT_FOUND]: { message: 'Agent not found', retryable: false },
  [ErrorCode.AGENT_ALREADY_SPAWNED]: { message: 'Agent is already spawned', retryable: false },
  [ErrorCode.AGENT_NOT_SPAWNED]: { message: 'Agent is not spawned', retryable: false },

  // Human Auth
  [ErrorCode.LOGIN_FAILED]: { message: 'Login failed: invalid username or password', retryable: false },
  [ErrorCode.USERNAME_TAKEN]: { message: 'Username already taken', retryable: false },
  [ErrorCode.SESSION_EXPIRED]: { message: 'Session expired', retryable: false },

  // Room
  [ErrorCode.ROOM_NOT_FOUND]: { message: 'Room not found', retryable: false },
  [ErrorCode.ROOM_ALREADY_EXISTS]: { message: 'Room already exists', retryable: false },
  [ErrorCode.NOT_ROOM_MEMBER]: { message: 'Not a member of this room', retryable: false },
  [ErrorCode.ROOM_IS_PRIVATE]: { message: 'Cannot join a private room', retryable: false },

  // Message
  [ErrorCode.MESSAGE_TOO_LARGE]: { message: 'Message exceeds 1MB limit', retryable: false },
  [ErrorCode.CROSS_ROOM_REPLY]: { message: 'Cross-room reply not allowed', retryable: false },
  [ErrorCode.THREAD_CYCLE]: { message: 'Thread reply would create a cycle', retryable: false },
  [ErrorCode.DUPLICATE_REACTION]: { message: 'Duplicate reaction', retryable: false },

  // Task
  [ErrorCode.TASK_NOT_FOUND]: { message: 'Task not found', retryable: false },
  [ErrorCode.INVALID_STATUS_TRANSITION]: { message: 'Invalid status transition', retryable: false },
  [ErrorCode.TASK_TERMINAL_STATE]: { message: 'Task is in terminal state', retryable: false },
  [ErrorCode.TASK_MAX_RETRIES]: { message: 'Task exceeded maximum retries', retryable: false },

  // Runtime
  [ErrorCode.RUNTIME_NOT_FOUND]: { message: 'Runtime not found', retryable: false },
  [ErrorCode.RUNTIME_OFFLINE]: { message: 'Runtime is offline', retryable: false },

  // Token
  [ErrorCode.TOKEN_BUDGET_EXCEEDED]: { message: 'Token budget exceeded', retryable: false },
};

export function createError(code: ErrorCode): AppError {
  const { message, retryable } = ERROR_MESSAGES[code];
  return { code, message, retryable };
}
