import type {
  Human,
  HumanRegisterRequest,
  HumanLoginRequest,
  HumanAuthResponse,
} from '@flock/shared';
import type { AgentFeedClient } from './client.js';

export function registerHuman(
  client: AgentFeedClient,
  req: HumanRegisterRequest,
): Promise<HumanAuthResponse> {
  return client.post<HumanAuthResponse>('/human/register', req);
}

export function loginHuman(
  client: AgentFeedClient,
  req: HumanLoginRequest,
): Promise<HumanAuthResponse> {
  return client.post<HumanAuthResponse>('/human/login', req);
}

export function getHumanMe(
  client: AgentFeedClient,
): Promise<Human> {
  return client.get<Human>('/human/me');
}
