import type { CreateRoomRequest, Room, OkResponse, ListRoomsResponse, RoomWithMemberCount, GetRoomMembersResponse } from '@flock/shared';
import type { AgentFeedClient } from './client.js';

export function createRoom(
  client: AgentFeedClient,
  req: CreateRoomRequest,
): Promise<Room> {
  return client.post<Room>('/rooms', req);
}

export function joinRoom(
  client: AgentFeedClient,
  roomId: string,
): Promise<OkResponse> {
  return client.post<OkResponse>(`/rooms/${roomId}/join`);
}

export function leaveRoom(
  client: AgentFeedClient,
  roomId: string,
): Promise<OkResponse> {
  return client.post<OkResponse>(`/rooms/${roomId}/leave`);
}

export function listRooms(
  client: AgentFeedClient,
  query?: { limit?: number; cursor?: string },
): Promise<ListRoomsResponse> {
  const params = new URLSearchParams();
  if (query?.limit) params.set('limit', String(query.limit));
  if (query?.cursor) params.set('cursor', query.cursor);
  const qs = params.toString();
  return client.get<ListRoomsResponse>(`/rooms${qs ? `?${qs}` : ''}`);
}

export function getRoom(
  client: AgentFeedClient,
  roomId: string,
): Promise<RoomWithMemberCount> {
  return client.get<RoomWithMemberCount>(`/rooms/${roomId}`);
}

export function getRoomMembers(
  client: AgentFeedClient,
  roomId: string,
): Promise<GetRoomMembersResponse> {
  return client.get<GetRoomMembersResponse>(`/rooms/${roomId}/members`);
}
