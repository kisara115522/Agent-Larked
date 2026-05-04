import type { SendReactionRequest, Reaction, GetThreadResponse } from '@lark/shared';
import type { AgentFeedClient } from './client.js';

export function react(
  client: AgentFeedClient,
  messageId: string,
  req: SendReactionRequest,
): Promise<Reaction> {
  return client.post<Reaction>(`/messages/${messageId}/reactions`, req);
}

export function getThread(
  client: AgentFeedClient,
  messageId: string,
): Promise<GetThreadResponse> {
  return client.get<GetThreadResponse>(`/messages/${messageId}/thread`);
}
