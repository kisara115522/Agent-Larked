import type {
  BroadcastRequest,
  BroadcastResponse,
  GetFeedQuery,
  GetFeedResponse,
} from '@flock/shared';
import type { AgentFeedClient } from './client.js';

export function broadcast(
  client: AgentFeedClient,
  req: BroadcastRequest,
): Promise<BroadcastResponse> {
  return client.post<BroadcastResponse>('/broadcast', req);
}

export function getFeed(
  client: AgentFeedClient,
  query: GetFeedQuery = {},
): Promise<GetFeedResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor !== undefined) params.set('cursor', String(query.cursor));

  const qs = params.toString();
  return client.get<GetFeedResponse>(
    `/feed${qs ? `?${qs}` : ''}`,
  );
}
