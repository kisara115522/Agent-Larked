export interface RuntimeConfig {
  flockServerUrl: string;
  agentToken: string;
  callbackHost: string;
  callbackPort: number;
  callbackSecret: string | null;
  maxAgents: number;
  heartbeatIntervalMs: number;
  dbPath: string;
}

export function loadConfig(): RuntimeConfig {
  const flockServerUrl = process.env.FLOCK_SERVER_URL ?? 'http://localhost:3001';
  const agentToken = process.env.AGENT_TOKEN ?? '';
  const callbackHost = process.env.CALLBACK_HOST ?? 'localhost';
  const callbackPort = Number(process.env.CALLBACK_PORT ?? 4000);
  const maxAgents = Number(process.env.MAX_AGENTS ?? 10);
  const heartbeatIntervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 30_000);
  const dbPath = process.env.DB_PATH ?? '';

  if (!agentToken) {
    throw new Error('AGENT_TOKEN environment variable is required');
  }

  return {
    flockServerUrl,
    agentToken,
    callbackHost,
    callbackPort,
    callbackSecret: null, // Set after registration
    maxAgents,
    heartbeatIntervalMs,
    dbPath,
  };
}
