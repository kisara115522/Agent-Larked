import { networkInterfaces } from 'node:os';

export interface RuntimeConfig {
  flockServerUrl: string;
  callbackHost: string;      // Advertised to server (LAN IP or hostname)
  callbackPort: number;
  callbackSecret: string | null;
  maxAgents: number;
  heartbeatIntervalMs: number;
  dbPath: string;
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
    maxAgents,
    heartbeatIntervalMs,
    dbPath,
  };
}
