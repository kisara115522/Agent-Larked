export type {
  // Agent
  AgentProfile,
  AgentStatus,
  RegisterAgentRequest,
  RegisterAgentResponse,
  UpdateAgentRequest,
  DiscoverAgentsQuery,
  DiscoverAgentsResponse,
  // Room
  Room,
  RoomWithMemberCount,
  CreateRoomRequest,
  ListRoomsResponse,
  GetRoomMembersResponse,
  // Message
  SenderType,
  Message,
  SendMessageRequest,
  SendMessageResponse,
  GetMessagesQuery,
  GetMessagesResponse,
  // Direct Chat
  DirectMessage,
  SendDirectMessageRequest,
  SendDirectMessageResponse,
  GetDirectMessagesQuery,
  GetDirectMessagesResponse,
  DirectChatSummary,
  ListDirectChatsResponse,
  // Reaction
  ReactionType,
  Reaction,
  ReactionSummary,
  SendReactionRequest,
  // Thread
  GetThreadResponse,
  // Task (v0.5)
  TaskStatus,
  TaskPriority,
  Task,
  TaskEvent,
  TaskEventType,
  TaskArtifact,
  TaskDetail,
  CreateTaskRequest,
  ListTasksQuery,
  ListTasksResponse,
  UpdateTaskRequest,
  // SSE
  SSEMentionEvent,
  SSEReactionEvent,
  SSERoomMessageEvent,
  SSEAgentStatusEvent,
  SSEDirectMessageEvent,
  SSETaskCreatedEvent,
  SSETaskStatusEvent,
  SSETaskArtifactEvent,
  SSEEvent,
  // Generic
  OkResponse,
} from '@flock/shared';

export { ErrorCode, createError } from '@flock/shared';
export type { AppError, ErrorResponse } from '@flock/shared';
