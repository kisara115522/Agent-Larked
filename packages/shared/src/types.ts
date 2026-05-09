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
  created_by: string;
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

export type SSEEvent =
  | { event: 'mention'; data: SSEMentionEvent }
  | { event: 'reaction'; data: SSEReactionEvent }
  | { event: 'room_message'; data: SSERoomMessageEvent }
  | { event: 'agent_status'; data: SSEAgentStatusEvent };

// Generic OK response
export interface OkResponse {
  ok: true;
}
