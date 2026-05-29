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
    console.log('');
    console.log('┌─────────────────────────────────────────────┐');
    console.log('│           Flock Agent Runtime               │');
    console.log('├─────────────────────────────────────────────┤');
    console.log(`│ Server:     ${config.flockServerUrl.padEnd(32)}│`);
    console.log(`│ Callback:   http://${config.callbackHost}:${config.callbackPort}`.padEnd(46) + '│');
    console.log(`│ Max agents: ${String(config.maxAgents).padEnd(32)}│`);
    console.log('└─────────────────────────────────────────────┘');
    console.log('');
    if (config.callbackHost !== 'localhost' && config.callbackHost !== '127.0.0.1') {
      console.log(`[runtime] LAN mode: other machines can spawn agents on this runtime.`);
      console.log(`[runtime] Ensure port ${config.callbackPort} is accessible on your network.`);
    } else {
      console.log(`[runtime] Local mode: only the server machine can reach this runtime.`);
      console.log(`[runtime] To enable LAN access, set CALLBACK_HOST to your LAN IP.`);
    }
    console.log('');
  } catch (err) {
    console.error('[runtime] Fatal error:', err);
    process.exit(1);
  }
}

main();
