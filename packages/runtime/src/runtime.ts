import type { RuntimeConfig } from './config.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createCallbackServer, type CallbackEvent } from './callback-server.js';
import { AgentRunner, type AgentSpawnOptions } from './agent-runner.js';

export class FlockAgentRuntime {
  private config: RuntimeConfig;
  private runtimeId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private runner: AgentRunner;
  private server: ReturnType<typeof createCallbackServer> | null = null;
  private serverInstance: ReturnType<typeof import('http').createServer> | null = null;

  constructor(config: RuntimeConfig) {
    this.config = config;
    this.runner = new AgentRunner(this.reportActivity.bind(this), config.flockServerUrl, config.dbPath);
  }

  async start(): Promise<void> {
    console.log(`[runtime] Starting Flock Agent Runtime...`);
    console.log(`[runtime] Server: ${this.config.flockServerUrl}`);
    console.log(`[runtime] Callback: ${this.config.callbackHost}:${this.config.callbackPort}`);

    // 1. Start callback server first (so we know our callback URL)
    await this.startCallbackServer();

    // 2. Register with Flock server
    await this.register();

    // 3. Start heartbeat
    this.startHeartbeat();

    console.log(`[runtime] Runtime started. ID: ${this.runtimeId}`);
    console.log(`[runtime] Waiting for spawn/wake callbacks...`);
  }

  async stop(): Promise<void> {
    console.log(`[runtime] Shutting down...`);

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Stop all agents
    await this.runner.shutdown();

    // Close callback server
    if (this.serverInstance) {
      this.serverInstance.close();
    }

    console.log(`[runtime] Shutdown complete.`);
  }

  private async startCallbackServer(): Promise<void> {
    this.server = createCallbackServer(this.config, this.handleCallback.bind(this));

    return new Promise((resolve, reject) => {
      // Callback server must bind 0.0.0.0 to receive callbacks from the Flock server,
      // even when HOST=localhost for other services. The advertised callback_url uses
      // the LAN IP so the server can reach us.
      this.serverInstance = this.server!.listen(
        this.config.callbackPort,
        '0.0.0.0',
        () => {
          console.log(
            `[runtime] Callback server listening on 0.0.0.0:${this.config.callbackPort}`,
          );
          console.log(
            `[runtime] Advertised callback URL: http://${this.config.callbackHost}:${this.config.callbackPort}`,
          );
          resolve();
        },
      );
      this.serverInstance.on('error', reject);
    });
  }

  private async register(): Promise<void> {
    const callbackUrl = `http://${this.config.callbackHost}:${this.config.callbackPort}`;
    if (!this.config.callbackSecret) {
      this.config.callbackSecret = readPersistedCallbackSecret(this.config.callbackSecretPath, callbackUrl);
    }
    const maxAttempts = 10;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(`${this.config.flockServerUrl}/runtimes`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            host: this.config.callbackHost,
            port: this.config.callbackPort,
            callback_url: callbackUrl,
            callback_secret: this.config.callbackSecret ?? undefined,
            registration_secret: this.config.registrationSecret ?? undefined,
            max_agents: this.config.maxAgents,
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Failed to register runtime: ${res.status} ${body}`);
        }

        const data = (await res.json()) as {
          id: string;
          callback_secret?: string;
        };

        this.runtimeId = data.id;

        // Store the callback secret returned by the server for signature verification
        if (data.callback_secret) {
          this.config.callbackSecret = data.callback_secret;
          persistCallbackSecret(this.config.callbackSecretPath, callbackUrl, data.callback_secret);
        }

        console.log(`[runtime] Registered as runtime ${this.runtimeId}`);
        return;
      } catch (err) {
        lastError = err;
        if (attempt === maxAttempts) break;
        console.warn(`[runtime] Registration attempt ${attempt}/${maxAttempts} failed; retrying...`);
        await delay(Math.min(500 * attempt, 3000));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      if (!this.runtimeId) return;

      try {
        const res = await fetch(
          `${this.config.flockServerUrl}/runtimes/${this.runtimeId}/heartbeat`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );

        if (!res.ok) {
          console.error(`[heartbeat] Failed: ${res.status}`);
        }
      } catch (err) {
        console.error(`[heartbeat] Error:`, err);
      }
    }, this.config.heartbeatIntervalMs);
  }

  private async handleCallback(event: CallbackEvent): Promise<void> {
    switch (event.type) {
      case 'spawn':
        await this.handleSpawn(event);
        break;
      case 'wake':
        await this.handleWake(event);
        break;
      case 'stop':
        await this.handleStop(event);
        break;
      default:
        console.warn(`[runtime] Unknown callback type: ${event.type}`);
    }
  }

  private async handleSpawn(event: CallbackEvent): Promise<void> {
    let prompt = event.prompt;
    if (!prompt) {
      if (event.room_id && event.room_name) {
        prompt = `You are agent ${event.agent_id}. You have been spawned in room "${event.room_name}" (${event.room_id}). Join this room and introduce yourself. Do not post in other rooms.`;
      } else {
        prompt = `You are agent ${event.agent_id}. You have been spawned in the Flock system. Wait for instructions — do not post in any room until given explicit context.`;
      }
    }

    prompt += '\n\nIMPORTANT: After responding, call flock_wait to wait for the next message. Do NOT exit. Stay available.';

    await this.runner.spawn(event.agent_id, prompt, event.agent_token, event.agent_name, {
      sessionId: event.session_id,
      model: event.agent_model,
      provider: normalizeProvider(event.agent_provider),
      backendConfig: this.config.defaultBackend,
      room: buildRoomContext(event),
      roomWorkspace: event.room_workspace,
    });
  }

  private async handleWake(event: CallbackEvent): Promise<void> {
    // Wake is like spawn but with context about who triggered it
    let prompt = event.prompt;
    if (!prompt) {
      if (event.room_id && event.room_name) {
        prompt = `You have been woken up in room "${event.room_name}". Check for new messages and respond. Do not post in other rooms.`;
      } else {
        prompt = 'You have been woken up. Wait for instructions — do not post in any room until given explicit context.';
      }
    }

    if (event.sender_name && event.excerpt) {
      prompt = `${event.sender_name} said: "${event.excerpt}"\n\n${prompt}`;
    }

    prompt += '\n\nIMPORTANT: After responding, call flock_wait to wait for the next message. Do NOT exit. Stay available.';

    await this.runner.spawn(event.agent_id, prompt, event.agent_token, event.agent_name, {
      sessionId: event.session_id,
      model: event.agent_model,
      provider: normalizeProvider(event.agent_provider),
      backendConfig: this.config.defaultBackend,
      room: buildRoomContext(event),
      roomWorkspace: event.room_workspace,
    });
  }

  private async handleStop(event: CallbackEvent): Promise<void> {
    await this.runner.stop(event.agent_id);
  }

  private async reportActivity(
    agentId: string,
    activityType: string,
    detail: string,
    metadata: Record<string, unknown> = {},
    agentToken?: string,
  ): Promise<void> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (agentToken) {
        headers['Authorization'] = `Bearer ${agentToken}`;
      }

      const res = await fetch(
        `${this.config.flockServerUrl}/agents/${agentId}/activity`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            activity_type: activityType,
            detail,
            metadata,
          }),
        },
      );

      if (!res.ok) {
        console.error(`[activity] Failed to report for ${agentId}: ${res.status}`);
      }
    } catch (err) {
      console.error(`[activity] Error reporting for ${agentId}:`, err);
    }
  }
}

type CallbackSecretStore = Record<string, string>;

function readPersistedCallbackSecret(path: string | undefined, callbackUrl: string): string | null {
  if (!path) return null;

  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as CallbackSecretStore;
    const secret = data[callbackUrl];
    return typeof secret === 'string' && secret.length > 0 ? secret : null;
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    console.warn(`[runtime] Could not read callback secret store ${path}:`, err);
    return null;
  }
}

function persistCallbackSecret(path: string | undefined, callbackUrl: string, secret: string): void {
  if (!path) return;

  let data: CallbackSecretStore = {};
  try {
    data = JSON.parse(readFileSync(path, 'utf8')) as CallbackSecretStore;
  } catch (err) {
    if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
      console.warn(`[runtime] Could not read callback secret store ${path}; overwriting:`, err);
    }
  }

  data[callbackUrl] = secret;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

function buildRoomContext(event: CallbackEvent): AgentSpawnOptions['room'] {
  if (!event.room_id) return undefined;
  return {
    roomId: event.room_id,
    roomName: event.room_name ?? event.room_id,
    roomRules: event.room_rules,
  };
}

function normalizeProvider(provider: unknown): AgentSpawnOptions['provider'] {
  if (provider === undefined || provider === null || provider === '') return undefined;
  if (typeof provider === 'string') return provider;
  if (typeof provider !== 'object' || Array.isArray(provider)) return undefined;

  const candidate = provider as { name?: unknown; env?: unknown };
  const env = typeof candidate.env === 'object' && candidate.env !== null && !Array.isArray(candidate.env)
    ? Object.fromEntries(
        Object.entries(candidate.env as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
    : undefined;

  return {
    ...(typeof candidate.name === 'string' && candidate.name.trim() ? { name: candidate.name.trim() } : {}),
    ...(env && Object.keys(env).length > 0 ? { env } : {}),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
