import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import type { BackendConfig, BackendType } from './backends/types.js';

const VALID_BACKEND_TYPES: readonly BackendType[] = ['claude-sdk', 'openai-compat'];

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

export interface RuntimeConfig {
  flockServerUrl: string;
  callbackHost: string;      // Advertised to server (LAN IP or hostname)
  callbackPort: number;
  callbackSecret: string | null;
  callbackSecretPath?: string;
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
  const callbackPort = parsePositiveInt(process.env.CALLBACK_PORT, 4000);
  const maxAgents = parsePositiveInt(process.env.MAX_AGENTS, 10);
  const heartbeatIntervalMs = parsePositiveInt(process.env.HEARTBEAT_INTERVAL_MS, 30_000);
  const dbPath = process.env.DB_PATH ?? '';
  const callbackSecretPath = process.env.RUNTIME_CALLBACK_SECRET_PATH
    ?? resolve(process.cwd(), 'data/runtime-callback-secrets.json');

  return {
    flockServerUrl,
    callbackHost,
    callbackPort,
    callbackSecret: process.env.RUNTIME_CALLBACK_SECRET ?? null,
    callbackSecretPath,
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
  const rawType = process.env.BACKEND_TYPE ?? 'claude-sdk';
  if (!VALID_BACKEND_TYPES.includes(rawType as BackendType)) {
    console.warn(`[config] WARNING: Invalid BACKEND_TYPE "${rawType}", falling back to "claude-sdk". Valid: ${VALID_BACKEND_TYPES.join(', ')}`);
  }
  const type: BackendType = (VALID_BACKEND_TYPES.includes(rawType as BackendType)
    ? rawType
    : 'claude-sdk') as BackendType;

  const config: BackendConfig = { type };

  // Model override (applies to both backends)
  if (process.env.AGENT_MODEL) {
    config.model = process.env.AGENT_MODEL;
  }

  // OpenAI-compatible backend specific config
  if (type === 'openai-compat') {
    config.apiEndpoint = process.env.OPENAI_API_ENDPOINT ?? 'https://api.openai.com/v1';
    config.apiKey = process.env.OPENAI_API_KEY;
    config.timeoutMs = parsePositiveInt(process.env.OPENAI_TIMEOUT_MS, 120_000);
    config.maxRetries = parsePositiveInt(process.env.OPENAI_MAX_RETRIES, 3);

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
