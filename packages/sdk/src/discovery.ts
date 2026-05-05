import type { DiscoverAgentsQuery, DiscoverAgentsResponse } from '@flock/shared';
import type { AgentFeedClient } from './client.js';

export function discover(
  client: AgentFeedClient,
  query: DiscoverAgentsQuery = {},
): Promise<DiscoverAgentsResponse> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.capabilities) params.set('capabilities', query.capabilities);
  if (query.status) params.set('status', query.status);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);

  const qs = params.toString();
  return client.get<DiscoverAgentsResponse>(`/agents${qs ? `?${qs}` : ''}`);
}
