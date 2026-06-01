import { networkInterfaces } from 'node:os';
import type { BackendConfig, BackendType } from './backends/types.js';

export interface RuntimeConfig {
  flockServerUrl: string;
  callbackHost: string;      // Advertised to server (LAN IP or hostname)
  callbackPort: number;
  callbackSecret: string | null;
  registrationSecret: string | null;  // Optional pre-shared secret for registration
  maxAgents: number;
  heartbeatIntervalMs: number;
  dbPath: string;
  /** Default backend configuration (can be overridden per-agent) */
  defaultBackend: BackendConfig;
}

function detectLanIp(): string {
  const nets = networkInterfaces();
  for (const iface of Object.values(nets)) {
    if (!iface) continue;
    for (const entry of iface) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return 'localhost';
}

export function loadConfig(): RuntimeConfig {
  const flockServerUrl = process.env.FLOCK_SERVER_URL ?? 'http://localhost:3001';
  const callbackHost = process.env.CALLBACK_HOST ?? detectLanIp();
  const callbackPort = Number(process.env.CALLBACK_PORT ?? 4000);
  const maxAgents = Number(process.env.MAX_AGENTS ?? 10);
  const heartbeatIntervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 30_000);
  const dbPath = process.env.DB_PATH ?? '';

  return {
    flockServerUrl,
    callbackHost,
    callbackPort,
    callbackSecret: null, // Set after registration
    registrationSecret: process.env.RUNTIME_REGISTRATION_SECRET ?? null,
    maxAgents,
    heartbeatIntervalMs,
    dbPath,
    defaultBackend: loadBackendConfig(),
  };
}

/**
 * Load backend configuration from environment variables.
 *
 * Environment variables:
 *  - BACKEND_TYPE: 'claude-sdk' (default) | 'openai-compat'
 *  - OPENAI_API_ENDPOINT: API endpoint for OpenAI-compatible backends
 *  - OPENAI_API_KEY: API key for OpenAI-compatible backends
 *  - OPENAI_TIMEOUT_MS: Request timeout in ms (default: 120000)
 *  - OPENAI_MAX_RETRIES: Max retry attempts (default: 3)
 *  - OPENAI_MODEL: Default model for OpenAI-compatible backend
 */
export function loadBackendConfig(): BackendConfig {
  const type: BackendType = (process.env.BACKEND_TYPE as BackendType) ?? 'claude-sdk';

  const config: BackendConfig = { type };

  // Model override (applies to both backends)
  if (process.env.AGENT_MODEL) {
    config.model = process.env.AGENT_MODEL;
  }

  // OpenAI-compatible backend specific config
  if (type === 'openai-compat') {
    config.apiEndpoint = process.env.OPENAI_API_ENDPOINT ?? 'https://api.openai.com/v1';
    config.apiKey = process.env.OPENAI_API_KEY;
    config.timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS ?? 120_000);
    config.maxRetries = Number(process.env.OPENAI_MAX_RETRIES ?? 3);

    if (process.env.OPENAI_MODEL) {
      config.model = process.env.OPENAI_MODEL;
    }

    // Validate required config
    if (!config.apiKey) {
      console.warn('[config] WARNING: OPENAI_API_KEY not set for openai-compat backend');
    }
  }

  return config;
}
