import type {
  SpawnAgentRequest,
  SpawnAgentResponse,
  AgentStatusResponse,
  OkResponse,
} from '@flock/shared';
import type { AgentFeedClient } from './client.js';

export function spawnAgent(
  client: AgentFeedClient,
  agentId: string,
  req?: SpawnAgentRequest,
): Promise<SpawnAgentResponse> {
  return client.post<SpawnAgentResponse>(`/agents/${agentId}/spawn`, req ?? {});
}

export function stopAgent(
  client: AgentFeedClient,
  agentId: string,
): Promise<OkResponse> {
  return client.post<OkResponse>(`/agents/${agentId}/stop`);
}

export function wakeAgent(
  client: AgentFeedClient,
  agentId: string,
  prompt?: string,
): Promise<OkResponse> {
  return client.post<OkResponse>(`/agents/${agentId}/wake`, { prompt });
}

export function getAgentStatus(
  client: AgentFeedClient,
  agentId: string,
): Promise<AgentStatusResponse> {
  return client.get<AgentStatusResponse>(`/agents/${agentId}/status`);
}
