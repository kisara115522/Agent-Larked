import { describe, expect, it } from 'vitest';
import {
  AGENT_TOKEN_KEY,
  clearAgentToken,
  storeAgentToken,
} from './tokenStorage';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length() {
    return this.data.size;
  }

  clear() {
    this.data.clear();
  }

  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  key(index: number) {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.data.delete(key);
  }

  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

describe('token storage policy', () => {
  it('stores and clears the current agent token', () => {
    const storage = new MemoryStorage();

    storeAgentToken('agent-token', storage);
    expect(storage.getItem(AGENT_TOKEN_KEY)).toBe('agent-token');

    clearAgentToken(storage);

    expect(storage.getItem(AGENT_TOKEN_KEY)).toBeNull();
  });
});
