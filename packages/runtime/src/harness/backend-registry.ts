/**
 * Backend Registry — manages available AgentBackend implementations.
 *
 * Backends register themselves at startup. The harness looks up the
 * appropriate backend by name when spawning an agent session.
 *
 * Usage:
 *   const registry = new BackendRegistry();
 *   registry.register('claude-sdk', createClaudeSdkBackend);
 *   registry.register('openai-compat', createOpenAICompatBackend);
 *
 *   const backend = registry.get({ type: 'claude-sdk' });
 */

import { createHash } from 'node:crypto';
import type {
  AgentBackend,
  BackendConfig,
  BackendFactory,
  BackendType,
} from '../backends/types.js';

const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CachedBackend {
  instance: AgentBackend;
  createdAt: number;
}

export class BackendRegistry {
  private factories = new Map<string, BackendFactory>();
  private cache = new Map<string, CachedBackend>();
  private cacheTtlMs: number;

  constructor(options?: { cacheTtlMs?: number }) {
    this.cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  /**
   * Register a backend factory.
   * The factory is called lazily when the backend is first requested.
   */
  register(type: BackendType, factory: BackendFactory): void {
    this.factories.set(type, factory);
  }

  /**
   * Get or create a backend instance for the given config.
   * Instances are cached by config hash with TTL.
   * Different configs for the same type (e.g. different API keys)
   * get separate instances.
   */
  get(config: BackendConfig): AgentBackend {
    const cacheKey = this.configHash(config);
    const cached = this.cache.get(cacheKey);

    // Return cached instance if still valid
    if (cached && (Date.now() - cached.createdAt) < this.cacheTtlMs) {
      return cached.instance;
    }

    // Evict expired entry
    if (cached) {
      this.cache.delete(cacheKey);
    }

    const factory = this.factories.get(config.type);
    if (!factory) {
      throw new Error(
        `Backend "${config.type}" not registered. Available: ${Array.from(this.factories.keys()).join(', ') || '(none)'}`,
      );
    }

    const instance = factory(config);
    this.cache.set(cacheKey, { instance, createdAt: Date.now() });
    return instance;
  }

  /**
   * Generate a cache key from config using SHA-256.
   * Different API keys always produce different hashes (no collision).
   */
  private configHash(config: BackendConfig): string {
    const keyHash = config.apiKey ? sha256Hex(config.apiKey) : '';
    return `${config.type}::${config.apiEndpoint ?? ''}::${keyHash}`;
  }

  /**
   * Check if a backend type is registered.
   */
  has(type: string): boolean {
    return this.factories.has(type);
  }

  /**
   * List all registered backend types.
   */
  list(): string[] {
    return Array.from(this.factories.keys());
  }

  /**
   * Clear all registrations and cached instances.
   */
  clear(): void {
    this.factories.clear();
    this.cache.clear();
  }
}

/**
 * Global default registry instance.
 * Backends register themselves here at import time.
 */
export const defaultBackendRegistry = new BackendRegistry();

/**
 * SHA-256 hex digest, truncated to 16 chars for cache key brevity.
 * Collision probability is negligible (2^-64).
 */
function sha256Hex(str: string): string {
  return createHash('sha256').update(str).digest('hex').slice(0, 16);
}
