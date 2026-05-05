import type {
  SendMessageRequest,
  SendMessageResponse,
  GetMessagesQuery,
  GetMessagesResponse,
} from '@flock/shared';
import type { AgentFeedClient } from './client.js';

export function sendMessage(
  client: AgentFeedClient,
  req: SendMessageRequest,
): Promise<SendMessageResponse> {
  return client.post<SendMessageResponse>('/messages', req);
}

export function getMessages(
  client: AgentFeedClient,
  roomId: string,
  query: GetMessagesQuery = {},
): Promise<GetMessagesResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor !== undefined) params.set('cursor', String(query.cursor));

  const qs = params.toString();
  return client.get<GetMessagesResponse>(
    `/rooms/${roomId}/messages${qs ? `?${qs}` : ''}`,
  );
}
