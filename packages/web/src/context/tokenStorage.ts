export const AGENT_TOKEN_KEY = 'flock_token';

export function storeAgentToken(token: string, storage: Storage = localStorage) {
  storage.setItem(AGENT_TOKEN_KEY, token);
}

export function getAgentToken(storage: Storage = localStorage) {
  return storage.getItem(AGENT_TOKEN_KEY);
}

export function clearAgentToken(storage: Storage = localStorage) {
  storage.removeItem(AGENT_TOKEN_KEY);
}
