import type { Invite, OkResponse, ListInvitesResponse } from '@flock/shared';
import type { AgentFeedClient } from './client.js';

export function inviteToRoom(
  client: AgentFeedClient,
  roomId: string,
  inviteeId: string,
): Promise<Invite> {
  return client.post<Invite>(`/rooms/${roomId}/invite`, { invitee_id: inviteeId });
}

export function acceptInvite(
  client: AgentFeedClient,
  inviteId: string,
): Promise<OkResponse> {
  return client.post<OkResponse>(`/invites/${inviteId}/accept`);
}

export function rejectInvite(
  client: AgentFeedClient,
  inviteId: string,
): Promise<OkResponse> {
  return client.post<OkResponse>(`/invites/${inviteId}/reject`);
}

export function getMyInvites(
  client: AgentFeedClient,
): Promise<ListInvitesResponse> {
  return client.get<ListInvitesResponse>('/agents/me/invites');
}
