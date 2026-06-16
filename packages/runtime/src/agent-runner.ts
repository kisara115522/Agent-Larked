import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentHarness, type SpawnRequest } from './harness/index.js';
import type { BackendConfig } from './backends/types.js';
import { defaultBackendRegistry } from './harness/backend-registry.js';
import { createClaudeSdkBackend } from './backends/claude-sdk.js';
import { createClaudeStdioBackend } from './backends/claude-stdio.js';
import { createOpenAICompatBackend } from './backends/openai-compat-backend.js';

defaultBackendRegistry.register('claude-sdk', createClaudeSdkBackend);
defaultBackendRegistry.register('claude-stdio', createClaudeStdioBackend);
defaultBackendRegistry.register('openai-compat', createOpenAICompatBackend);

export interface AgentInstance {
  agentId: string;
  agentName: string;
  sessionId: string;
  status: 'spawning' | 'active' | 'dormant' | 'error';
  abortController?: AbortController;
  startedAt: Date;
  lastActiveAt: Date;
  prompt: string;
  agentToken?: string;
  options?: AgentSpawnOptions;
}

export interface AgentProviderOptions {
  name?: string;
  env?: Record<string, string>;
}

export interface AgentSpawnOptions {
  model?: string;
  provider?: string | AgentProviderOptions;
  sessionId?: string;
  backend?: 'claude-sdk' | 'claude-stdio' | 'openai-compat';
  backendConfig?: BackendConfig;
  env?: Record<string, string>;
}

export type ActivityReporter = (
  agentId: string,
  activityType: string,
  detail: string,
  metadata?: Record<string, unknown>,
  agentToken?: string,
) => Promise<void>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const MCP_SERVER_PATH = path.resolve(PROJECT_ROOT, 'packages/mcp/dist/index.js');

export class AgentRunner {
  private harness: AgentHarness;
  private agentInstances = new Map<string, AgentInstance>();
  private reportActivity: ActivityReporter;

  constructor(
    reportActivity: ActivityReporter,
    flockServerUrl: string,
    dbPath?: string,
  ) {
    this.reportActivity = reportActivity;
    this.harness = new AgentHarness({
      flockServerUrl,
      cwd: PROJECT_ROOT,
      mcpServerPath: MCP_SERVER_PATH,
      dbPath: dbPath ?? path.resolve(PROJECT_ROOT, 'data/agentfeed.db'),
      reportActivity,
    });
  }

  getAgent(agentId: string): AgentInstance | undefined {
    return this.agentInstances.get(agentId);
  }

  getAllAgents(): AgentInstance[] {
    return Array.from(this.agentInstances.values());
  }

  isRunning(agentId: string): boolean {
    const instance = this.agentInstances.get(agentId);
    return instance !== undefined && (instance.status === 'spawning' || instance.status === 'active');
  }

  async spawn(
    agentId: string,
    prompt: string,
    agentToken?: string,
    agentName?: string,
    options?: AgentSpawnOptions,
  ): Promise<string> {
    if (this.isRunning(agentId)) {
      console.log(`[runner] Agent ${agentId} already running, skipping spawn`);
      return this.agentInstances.get(agentId)!.sessionId;
    }

    const resolvedAgentName = agentName ?? `agent-${agentId.slice(0, 8)}`;
    const sessionId = options?.sessionId ?? randomUUID();
    const instance: AgentInstance = {
      agentId,
      agentName: resolvedAgentName,
      sessionId,
      status: 'spawning',
      startedAt: new Date(),
      lastActiveAt: new Date(),
      prompt,
      agentToken,
      options,
    };
    this.agentInstances.set(agentId, instance);

    const backendConfig: BackendConfig = options?.backendConfig
      ?? { type: options?.backend ?? 'claude-stdio', model: options?.model };
    const providerEnv = resolveProviderEnv(options?.provider);
    const mergedEnv = providerEnv || options?.env
      ? { ...providerEnv, ...options?.env }
      : undefined;

    const request: SpawnRequest = {
      agentId,
      agentName: resolvedAgentName,
      prompt,
      agentToken,
      backendConfig,
      model: options?.model,
      sessionId: options?.sessionId,
      env: mergedEnv,
    };

    console.log(`[runner] Spawning agent ${agentId} via harness (backend=${backendConfig.type})`);

    await this.reportActivity(agentId, 'status_change', 'Agent spawning', {
      session_id: sessionId,
    }, agentToken);

    try {
      const session = await this.harness.spawn(request);
      instance.sessionId = session.sessionId;
      instance.status = 'active';
      instance.abortController = session.abortController;

      session.promise.then((finalState) => {
        instance.lastActiveAt = new Date();
        instance.status = finalState.status === 'completed' ? 'dormant'
          : finalState.status === 'aborted' ? 'dormant'
            : 'error';
        instance.abortController = undefined;
        if (finalState.status !== 'error') {
          this.agentInstances.delete(agentId);
        }
      }).catch(() => {
        instance.status = 'error';
        instance.abortController = undefined;
        this.agentInstances.delete(agentId);
      });

      return session.sessionId;
    } catch (err) {
      console.error(`[runner] Failed to spawn agent ${agentId}:`, err);
      instance.status = 'error';
      this.agentInstances.delete(agentId);
      throw err;
    }
  }

  async stop(agentId: string): Promise<boolean> {
    const instance = this.agentInstances.get(agentId);
    if (!instance) return false;

    console.log(`[runner] Stopping agent ${agentId}`);
    this.harness.abort(agentId);

    instance.status = 'dormant';
    instance.abortController = undefined;
    this.agentInstances.delete(agentId);

    await this.reportActivity(agentId, 'status_change', 'Agent stopped', {
      session_id: instance.sessionId,
    }, instance.agentToken);

    return true;
  }

  async shutdown(): Promise<void> {
    console.log('[runner] Shutting down...');
    await this.harness.shutdown();
    this.agentInstances.clear();
  }
}

function resolveProviderEnv(
  provider: string | AgentProviderOptions | undefined,
): Record<string, string> | undefined {
  if (!provider) return undefined;
  if (typeof provider === 'string') {
    return { AGENT_PROVIDER: provider };
  }
  return {
    ...(provider.name ? { AGENT_PROVIDER: provider.name } : {}),
    ...provider.env,
  };
}
