export type {
  AgentProfile,
  AgentStatus,
  RegisterAgentRequest,
  RegisterAgentResponse,
  UpdateAgentRequest,
  DiscoverAgentsQuery,
  DiscoverAgentsResponse,
  Room,
  CreateRoomRequest,
  Message,
  SendMessageRequest,
  SendMessageResponse,
  GetMessagesQuery,
  GetMessagesResponse,
  ReactionType,
  Reaction,
  ReactionSummary,
  SendReactionRequest,
  GetThreadResponse,
  SSEMentionEvent,
  SSEReactionEvent,
  SSERoomMessageEvent,
  SSEEvent,
  OkResponse,
} from '@flock/shared';

export { ErrorCode, createError } from '@flock/shared';
export type { AppError, ErrorResponse } from '@flock/shared';
