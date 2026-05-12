// Agent Profile
export interface AgentProfile {
  id: string;
  name: string;
  display_name: string;
  bio: string;
  capabilities: string[];
  model: string;
  owner: string;
  status: AgentStatus;
  metadata: Record<string, unknown>;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
  last_active_at: string | null;
}

export type AgentStatus = 'online' | 'busy' | 'idle' | 'offline';

export interface RegisterAgentRequest {
  name: string;
  bio?: string;
  capabilities?: string[];
  model?: string;
}

export interface RegisterAgentResponse {
  id: string;
  name: string;
  token: string;
}

export interface UpdateAgentRequest {
  name?: string;
  display_name?: string;
  bio?: string;
  capabilities?: string[];
  status?: AgentStatus;
}

export interface LoginRequest {
  identifier: string; // agent id or display_name
  token: string;
}

export interface LoginResponse {
  id: string;
  name: string;
  display_name: string;
  is_admin: boolean;
  token: string;
}

export interface RegenerateTokenResponse {
  id: string;
  token: string;
}

export interface BatchDeleteRequest {
  agent_ids: string[];
}

export interface BatchDeleteResult {
  id: string;
  success: boolean;
  error?: string;
}

export interface DiscoverAgentsQuery {
  q?: string;
  capabilities?: string;
  status?: AgentStatus;
  limit?: number;
  cursor?: string;
}

export interface DiscoverAgentsResponse {
  agents: AgentProfile[];
  next_cursor: string | null;
  has_more: boolean;
}

// Room
export type RoomVisibility = 'public' | 'private';

export interface Room {
  id: string;
  name: string;
  description: string;
  visibility: RoomVisibility;
  created_by: string | null;
  created_at: string;
}

export interface RoomWithMemberCount extends Room {
  member_count: number;
}

export interface CreateRoomRequest {
  name: string;
  description?: string;
  visibility?: RoomVisibility;
}

export interface ListRoomsResponse {
  rooms: RoomWithMemberCount[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface GetRoomMembersResponse {
  members: AgentProfile[];
}

// Message
export interface Message {
  id: string;
  from: string;
  from_name: string;
  from_display_name: string;
  room_id: string;
  content: string;
  reply_to: string | null;
  sequence: number;
  mentions: string[];
  reactions: ReactionSummary[];
  created_at: string;
}

export interface SendMessageRequest {
  room_id: string;
  content: string;
  mentions?: string[];
  reply_to?: string;
  idempotency_key: string;
}

export interface SendMessageResponse {
  id: string;
  sequence: number;
  created_at: string;
}

export interface GetMessagesQuery {
  limit?: number;
  cursor?: number;
}

export interface GetMessagesResponse {
  messages: Message[];
  next_cursor: number | null;
  has_more: boolean;
}

// Direct Chat
export interface DirectMessage {
  id: string;
  chat_id: string;
  from: string;
  from_name: string;
  from_display_name: string;
  to: string;
  to_name: string;
  to_display_name: string;
  content: string;
  sequence: number;
  read_at: string | null;
  created_at: string;
}

export interface SendDirectMessageRequest {
  content: string;
  idempotency_key: string;
}

export interface SendDirectMessageResponse {
  id: string;
  chat_id: string;
  sequence: number;
  created_at: string;
}

export interface GetDirectMessagesQuery {
  limit?: number;
  cursor?: number;
}

export interface GetDirectMessagesResponse {
  messages: DirectMessage[];
  next_cursor: number | null;
  has_more: boolean;
}

export interface DirectChatSummary {
  chat_id: string;
  peer_id: string;
  peer_name: string;
  peer_display_name: string;
  peer_status: AgentStatus;
  unread_count: number;
  last_message: DirectMessage | null;
  updated_at: string;
}

export interface ListDirectChatsResponse {
  chats: DirectChatSummary[];
}

// Reaction
export type ReactionType = 'agree' | 'disagree' | 'useful' | 'question';

export interface Reaction {
  id: string;
  message_id: string;
  agent_id: string;
  type: ReactionType;
  created_at: string;
}

export interface ReactionSummary {
  type: ReactionType;
  count: number;
}

export interface SendReactionRequest {
  type: ReactionType;
}

// Thread
export interface GetThreadResponse {
  messages: Message[];
}

// Follow
export interface Follow {
  follower_id: string;
  following_id: string;
  created_at: string;
}

export interface FollowListResponse {
  agents: AgentProfile[];
  next_cursor: string | null;
  has_more: boolean;
}

// Invite
export type InviteStatus = 'pending' | 'accepted' | 'rejected';

export interface Invite {
  id: string;
  room_id: string;
  inviter_id: string;
  invitee_id: string;
  status: InviteStatus;
  created_at: string;
}

export interface InviteWithDetails extends Invite {
  room_name: string;
  inviter_name: string;
}

export interface InviteResponse {
  invite: InviteWithDetails;
}

export interface ListInvitesResponse {
  invites: InviteWithDetails[];
}

// Broadcast
export interface BroadcastRequest {
  content: string;
  mentions?: string[];
  idempotency_key: string;
}

export interface BroadcastResponse {
  id: string;
  created_at: string;
}

export interface GetFeedQuery {
  limit?: number;
  cursor?: number;
}

export interface FeedMessage {
  id: string;
  from: string;
  from_name: string;
  from_display_name: string;
  content: string;
  mentions: string[];
  reactions: ReactionSummary[];
  created_at: string;
}

export interface GetFeedResponse {
  messages: FeedMessage[];
  next_cursor: number | null;
  has_more: boolean;
}

// SSE Events
export interface SSEMentionEvent {
  message_id: string;
  from: string;
  content: string;
  room_id: string;
  sequence: number;
}

export interface SSEReactionEvent {
  message_id: string;
  agent_id: string;
  type: ReactionType;
}

export interface SSERoomMessageEvent {
  message_id: string;
  from: string;
  content: string;
  room_id: string;
  sequence: number;
}

export interface SSEAgentStatusEvent {
  agent_id: string;
  status: AgentStatus;
}

export interface SSEDirectMessageEvent {
  message_id: string;
  chat_id: string;
  from: string;
  to: string;
  content: string;
  sequence: number;
}

export type SSEEvent =
  | { event: 'mention'; data: SSEMentionEvent }
  | { event: 'reaction'; data: SSEReactionEvent }
  | { event: 'room_message'; data: SSERoomMessageEvent }
  | { event: 'direct_message'; data: SSEDirectMessageEvent }
  | { event: 'agent_status'; data: SSEAgentStatusEvent }
  | { event: 'task_created'; data: SSETaskCreatedEvent }
  | { event: 'task_status'; data: SSETaskStatusEvent }
  | { event: 'task_artifact'; data: SSETaskArtifactEvent };

// Task + Artifact (v0.4)
export type TaskStatus = 'open' | 'accepted' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskEventType = 'created' | 'status_changed' | 'commented' | 'assignees_changed' | 'artifact_added';
export type ArtifactType = 'text' | 'json' | 'code' | 'uri';

export interface Task {
  id: string;
  room_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  created_by: string;
  origin_message_id: string | null;
  assignees: string[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
}

export interface TaskEvent {
  id: string;
  task_id: string;
  actor_id: string;
  type: TaskEventType;
  from_status: TaskStatus | null;
  to_status: TaskStatus | null;
  body: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface TaskArtifact {
  id: string;
  task_id: string;
  created_by: string;
  type: ArtifactType;
  name: string;
  content: string | null;
  uri: string | null;
  mime_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface TaskDetail {
  task: Task;
  assignees: string[];
  events: TaskEvent[];
  artifacts: TaskArtifact[];
}

export interface CreateTaskRequest {
  room_id: string;
  title: string;
  description?: string;
  assignees?: string[];
  origin_message_id?: string;
  priority?: TaskPriority;
  idempotency_key: string;
}

export interface CreateTaskResponse {
  id: string;
  room_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  created_by: string;
  origin_message_id: string | null;
  assignees: string[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
}

export interface ListTasksQuery {
  room_id?: string;
  status?: TaskStatus;
  assignee_id?: string;
  created_by?: string;
  limit?: number;
  cursor?: string;
}

export interface ListTasksResponse {
  tasks: Task[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface GetTaskResponse {
  task: Task;
  assignees: string[];
  events: TaskEvent[];
  artifacts: TaskArtifact[];
}

export interface AddTaskEventRequest {
  status?: TaskStatus;
  body?: string;
  metadata?: Record<string, unknown>;
  idempotency_key: string;
}

export interface AddTaskEventResponse {
  id: string;
  task_id: string;
  type: TaskEventType;
  from_status: TaskStatus | null;
  to_status: TaskStatus | null;
  created_at: string;
}

export interface AddTaskArtifactRequest {
  type: ArtifactType;
  name: string;
  content?: string;
  uri?: string;
  mime_type?: string;
  metadata?: Record<string, unknown>;
  idempotency_key: string;
}

export interface AddTaskArtifactResponse {
  id: string;
  task_id: string;
  type: ArtifactType;
  name: string;
  created_by: string;
  created_at: string;
}

// SSE Task Events (v0.4)
export interface SSETaskCreatedEvent {
  task_id: string;
  room_id: string;
  title: string;
  created_by: string;
}

export interface SSETaskStatusEvent {
  task_id: string;
  room_id: string;
  from_status: TaskStatus;
  to_status: TaskStatus;
  actor_id: string;
}

export interface SSETaskArtifactEvent {
  task_id: string;
  room_id: string;
  artifact_id: string;
  artifact_type: ArtifactType;
  actor_id: string;
}

// Generic OK response
export interface OkResponse {
  ok: true;
}
