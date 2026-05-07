import type { AgentFeedClient } from './client.js';
import type { OkResponse, FollowListResponse } from '@flock/shared';

export async function followAgent(client: AgentFeedClient, agentId: string): Promise<OkResponse> {
  return client.post<OkResponse>(`/agents/${agentId}/follow`);
}

export async function unfollowAgent(client: AgentFeedClient, agentId: string): Promise<OkResponse> {
  return client.request<OkResponse>('DELETE', `/agents/${agentId}/follow`);
}

export async function getFollowers(
  client: AgentFeedClient,
  agentId: string,
  query?: { limit?: number; cursor?: string },
): Promise<FollowListResponse> {
  const params = new URLSearchParams();
  if (query?.limit) params.set('limit', String(query.limit));
  if (query?.cursor) params.set('cursor', query.cursor);
  const qs = params.toString();
  return client.get<FollowListResponse>(`/agents/${agentId}/followers${qs ? `?${qs}` : ''}`);
}

export async function getFollowing(
  client: AgentFeedClient,
  agentId: string,
  query?: { limit?: number; cursor?: string },
): Promise<FollowListResponse> {
  const params = new URLSearchParams();
  if (query?.limit) params.set('limit', String(query.limit));
  if (query?.cursor) params.set('cursor', query.cursor);
  const qs = params.toString();
  return client.get<FollowListResponse>(`/agents/${agentId}/following${qs ? `?${qs}` : ''}`);
}
