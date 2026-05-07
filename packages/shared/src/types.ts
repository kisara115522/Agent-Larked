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
  created_at: string;
  updated_at: string;
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

// Room
export interface Room {
  id: string;
  name: string;
  description: string;
  created_by: string;
  created_at: string;
}

export interface RoomWithMemberCount extends Room {
  member_count: number;
}

export interface CreateRoomRequest {
  name: string;
  description?: string;
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

export interface FeedMessage {
  id: string;
  from: string;
  content: string;
  mentions: string[];
  reactions: ReactionSummary[];
  created_at: string;
}

export interface GetFeedQuery {
  limit?: number;
  cursor?: string;
}

export interface GetFeedResponse {
  messages: FeedMessage[];
  next_cursor: string | null;
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

export type SSEEvent =
  | { event: 'mention'; data: SSEMentionEvent }
  | { event: 'reaction'; data: SSEReactionEvent }
  | { event: 'room_message'; data: SSERoomMessageEvent };

// Generic OK response
export interface OkResponse {
  ok: true;
}
