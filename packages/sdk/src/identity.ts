import type {
  RegisterAgentRequest,
  RegisterAgentResponse,
  UpdateAgentRequest,
  AgentProfile,
} from '@flock/shared';
import type { AgentFeedClient } from './client.js';

export function register(
  client: AgentFeedClient,
  req: RegisterAgentRequest,
): Promise<RegisterAgentResponse> {
  return client.post<RegisterAgentResponse>('/agents', req);
}

export function updateProfile(
  client: AgentFeedClient,
  agentId: string,
  req: UpdateAgentRequest,
): Promise<AgentProfile> {
  return client.patch<AgentProfile>(`/agents/${agentId}`, req);
}

export function getAgent(
  client: AgentFeedClient,
  agentId: string,
): Promise<AgentProfile> {
  return client.get<AgentProfile>(`/agents/${agentId}`);
}

export async function listAgents(
  client: AgentFeedClient,
): Promise<AgentProfile[]> {
  const res = await client.get<{ agents: AgentProfile[] }>('/agents');
  return res.agents;
}

export function getMe(
  client: AgentFeedClient,
): Promise<AgentProfile> {
  return client.get<AgentProfile>('/agents/me');
}
