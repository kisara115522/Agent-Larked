import type {
  GetDirectMessagesQuery,
  GetDirectMessagesResponse,
  ListDirectChatsResponse,
  SendDirectMessageRequest,
  SendDirectMessageResponse,
} from '@flock/shared';
import type { AgentFeedClient } from './client.js';

export function sendDirectMessage(
  client: AgentFeedClient,
  agentId: string,
  req: SendDirectMessageRequest,
): Promise<SendDirectMessageResponse> {
  return client.post<SendDirectMessageResponse>(`/direct-chats/${agentId}/messages`, req);
}

export function getDirectMessages(
  client: AgentFeedClient,
  agentId: string,
  query: GetDirectMessagesQuery = {},
): Promise<GetDirectMessagesResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor !== undefined) params.set('cursor', String(query.cursor));

  const qs = params.toString();
  return client.get<GetDirectMessagesResponse>(
    `/direct-chats/${agentId}/messages${qs ? `?${qs}` : ''}`,
  );
}

export function listDirectChats(client: AgentFeedClient): Promise<ListDirectChatsResponse> {
  return client.get<ListDirectChatsResponse>('/direct-chats');
}
