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
 *   const backend = registry.get('claude-sdk');
 */

import type {
  AgentBackend,
  BackendConfig,
  BackendFactory,
  BackendType,
} from '../backends/types.js';

export class BackendRegistry {
  private factories = new Map<string, BackendFactory>();
  private instances = new Map<string, AgentBackend>();

  /**
   * Register a backend factory.
   * The factory is called lazily when the backend is first requested.
   */
  register(type: BackendType, factory: BackendFactory): void {
    this.factories.set(type, factory);
  }

  /**
   * Get or create a backend instance for the given config.
   * Instances are cached by config hash — same type + endpoint + apiKey
   * returns the same instance. Different configs for the same type
   * (e.g. two openai-compat with different endpoints) get separate instances.
   */
  get(config: BackendConfig): AgentBackend {
    const cacheKey = this.configHash(config);
    const existing = this.instances.get(cacheKey);
    if (existing) return existing;

    const factory = this.factories.get(config.type);
    if (!factory) {
      throw new Error(
        `Backend "${config.type}" not registered. Available: ${Array.from(this.factories.keys()).join(', ') || '(none)'}`,
      );
    }

    const instance = factory(config);
    this.instances.set(cacheKey, instance);
    return instance;
  }

  /**
   * Generate a cache key from config. Two configs with the same
   * type + endpoint + apiKey share the same backend instance.
   * Different API keys produce different hashes to avoid sharing instances.
   */
  private configHash(config: BackendConfig): string {
    const keyHash = config.apiKey ? simpleHash(config.apiKey) : '';
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
    this.instances.clear();
  }
}

/**
 * Global default registry instance.
 * Backends register themselves here at import time.
 */
export const defaultBackendRegistry = new BackendRegistry();

/**
 * Simple non-cryptographic hash for cache key generation.
 * Avoids exposing API keys while differentiating different keys.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}
