import type { RuntimeConfig } from './config.js';
import { createCallbackServer, type CallbackEvent } from './callback-server.js';
import { AgentRunner } from './agent-runner.js';

export class FlockAgentRuntime {
  private config: RuntimeConfig;
  private runtimeId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private runner: AgentRunner;
  private server: ReturnType<typeof createCallbackServer> | null = null;
  private serverInstance: ReturnType<typeof import('http').createServer> | null = null;

  constructor(config: RuntimeConfig) {
    this.config = config;
    this.runner = new AgentRunner(this.reportActivity.bind(this), config.flockServerUrl);
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
      this.serverInstance = this.server!.listen(
        this.config.callbackPort,
        this.config.callbackHost,
        () => {
          console.log(
            `[runtime] Callback server listening on ${this.config.callbackHost}:${this.config.callbackPort}`,
          );
          resolve();
        },
      );
      this.serverInstance.on('error', reject);
    });
  }

  private async register(): Promise<void> {
    const callbackUrl = `http://${this.config.callbackHost}:${this.config.callbackPort}`;

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
    }

    console.log(`[runtime] Registered as runtime ${this.runtimeId}`);
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
    const prompt =
      event.prompt ??
      `You are agent ${event.agent_id}. You have been spawned in the Flock system. Introduce yourself in the room.`;

    await this.runner.spawn(event.agent_id, prompt, event.agent_token);
  }

  private async handleWake(event: CallbackEvent): Promise<void> {
    // Wake is like spawn but with context about who triggered it
    let prompt =
      event.prompt ?? 'You have been woken up. Check for new messages and respond.';

    if (event.sender_name && event.excerpt) {
      prompt = `${event.sender_name} said: "${event.excerpt}"\n\n${prompt}`;
    }

    await this.runner.spawn(event.agent_id, prompt, event.agent_token);
  }

  private async handleStop(event: CallbackEvent): Promise<void> {
    await this.runner.stop(event.agent_id);
  }

  private async reportActivity(
    agentId: string,
    activityType: string,
    detail: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      const res = await fetch(
        `${this.config.flockServerUrl}/agents/${agentId}/activity`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
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
