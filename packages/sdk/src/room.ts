import type { CreateRoomRequest, Room, OkResponse } from '@lark/shared';
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
