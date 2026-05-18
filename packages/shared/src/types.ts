// ============================================================================
// Agent-Larked v0.5 Shared Types
// ============================================================================

// --- Agent Profile ---

export type AgentStatus = 'active' | 'dormant' | 'recovering' | 'error' | 'spawning';

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
  created_at: string;
  updated_at: string;
  last_active_at: string | null;
}

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

// --- Human ---

export interface Human {
  id: string;
  username: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface HumanRegisterRequest {
  username: string;
  password: string;
  display_name?: string;
}

export interface HumanLoginRequest {
  username: string;
  password: string;
}

export interface HumanAuthResponse {
  id: string;
  token: string;
}

// --- Agent Runtime ---

export interface AgentRuntime {
  id: string;
  host: string;
  port: number;
  callback_url: string;
  capabilities: string[];
  max_agents: number;
  status: 'online' | 'offline';
  last_heartbeat_at: string | null;
  created_at: string;
}

export interface RegisterRuntimeRequest {
  host: string;
  port: number;
  callback_url: string;
  callback_secret: string;
  capabilities?: string[];
  max_agents?: number;
}

export interface RegisterRuntimeResponse {
  id: string;
  status: string;
}

// --- Agent Spawn ---

export interface AgentSpawn {
  id: string;
  agent_id: string;
  runtime_id: string;
  session_id: string | null;
  status: AgentStatus;
  spawned_at: string;
  last_active_at: string | null;
  prompt: string | null;
}

export interface SpawnAgentRequest {
  runtime_id?: string;
  prompt?: string;
}

export interface SpawnAgentResponse {
  spawn_id: string;
  status: string;
}

export interface AgentStatusResponse {
  status: AgentStatus;
  runtime_id?: string;
  session_id?: string;
  last_active_at?: string;
}

// --- Room ---

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

// --- Message ---

export type SenderType = 'human' | 'agent';

export interface Message {
  id: string;
  from: string;
  from_name: string;
  from_display_name: string;
  sender_type: SenderType;
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
  sender_type?: SenderType;
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

// --- Direct Chat ---

export interface DirectMessage {
  id: string;
  chat_id: string;
  from: string;
  from_name: string;
  from_display_name: string;
  sender_type: SenderType;
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

// --- Reaction ---

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

// --- Thread ---

export interface GetThreadResponse {
  messages: Message[];
}

// --- Task (v0.5) ---

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'rejected' | 'error';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Task {
  id: string;
  room_id: string;
  parent_task_id: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  assigned_to: string | null;
  required_capabilities: string[];
  priority: TaskPriority;
  retry_count: number;
  max_retries: number;
  message_id: string | null;
  orchestrator_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type TaskEventType =
  | 'created'
  | 'assigned'
  | 'started'
  | 'progress'
  | 'review'
  | 'approved'
  | 'rejected'
  | 'failed'
  | 'retry'
  | 'completed';

export interface TaskEvent {
  id: string;
  task_id: string;
  event_type: TaskEventType;
  actor_id: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface TaskArtifact {
  id: string;
  task_id: string;
  agent_id: string;
  name: string;
  path: string;
  content_type: string;
  size: number;
  created_at: string;
}

export interface TaskDetail {
  task: Task;
  events: TaskEvent[];
  artifacts: TaskArtifact[];
}

export interface CreateTaskRequest {
  room_id: string;
  title: string;
  description?: string;
  assigned_to?: string;
  priority?: TaskPriority;
  required_capabilities?: string[];
  orchestrator_id?: string;
}

export interface ListTasksQuery {
  room_id?: string;
  status?: TaskStatus;
  assigned_to?: string;
  limit?: number;
  cursor?: string;
}

export interface ListTasksResponse {
  tasks: Task[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface UpdateTaskRequest {
  status?: TaskStatus;
  assigned_to?: string;
  priority?: TaskPriority;
  orchestrator_id?: string;
}

// --- Token Budget ---

export interface TokenUsage {
  daily: number;
  monthly: number;
  history: TokenUsageEntry[];
}

export interface TokenUsageEntry {
  date: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
}

export interface TokenBudget {
  daily_limit: number;
  monthly_limit: number;
  current_daily: number;
  current_monthly: number;
}

export interface UpdateTokenBudgetRequest {
  daily_limit?: number;
  monthly_limit?: number;
}

// --- Agent Config ---

export type AgentConfigType = 'soul' | 'agent_md' | 'skills' | 'mcp';

export interface AgentConfig {
  config_type: AgentConfigType;
  config_value: string;
}

export interface UpdateAgentConfigRequest {
  config_value: string;
}

export type GlobalConfigType = 'skills' | 'mcp';

export interface GlobalConfig {
  config_type: GlobalConfigType;
  config_value: string;
}

export interface UpdateGlobalConfigRequest {
  config_value: string;
}

// --- SSE Events ---

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
  sender_type: SenderType;
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
  from: string;
  to: string;
  content: string;
  sequence: number;
}

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
  artifact_name: string;
  actor_id: string;
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

// --- Generic ---

export interface OkResponse {
  ok: true;
}
