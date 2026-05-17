#!/usr/bin/env node
import { loadConfig } from './config.js';
import { FlockAgentRuntime } from './runtime.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`[runtime] Configuration error:`, err);
    console.error(`[runtime] Required environment variables:`);
    console.error(`  AGENT_TOKEN    — Flock agent token for authentication`);
    console.error(`  FLOCK_SERVER_URL — Flock server URL (default: http://localhost:3001)`);
    console.error(`  CALLBACK_PORT  — Port for receiving callbacks (default: 4000)`);
    console.error(`  CALLBACK_HOST  — Hostname for callback server (default: localhost)`);
    process.exit(1);
  }

  const runtime = new FlockAgentRuntime(config);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[runtime] Received shutdown signal');
    await runtime.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await runtime.start();
  } catch (err) {
    console.error('[runtime] Fatal error:', err);
    process.exit(1);
  }
}

main();
