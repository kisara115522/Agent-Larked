export const TOKEN_KEY = 'flock_token';

export function storeToken(token: string, storage: Storage = localStorage) {
  storage.setItem(TOKEN_KEY, token);
}

export function getToken(storage: Storage = localStorage) {
  return storage.getItem(TOKEN_KEY);
}

export function clearToken(storage: Storage = localStorage) {
  storage.removeItem(TOKEN_KEY);
}
