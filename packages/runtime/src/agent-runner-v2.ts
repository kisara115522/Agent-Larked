/**
 * AgentRunner v2 — refactored to use AgentHarness.
 *
 * This is the migration bridge between the existing AgentRunner (which directly
 * calls the Claude SDK) and the new AgentHarness architecture.
 *
 * Key changes from v1:
 *  - Delegates to AgentHarness for backend dispatching
 *  - Supports both ClaudeSdkBackend and OpenAICompatBackend via config
 *  - Preserves the same public API (spawn, stop, isRunning, etc.)
 *
 * Usage:
 *   // Drop-in replacement:
 *   const runner = new AgentRunnerV2(reportActivity, serverUrl, dbPath);
 *   await runner.spawn(agentId, prompt, token, name, { model: 'deepseek-chat', backend: 'openai-compat' });
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentHarness, type SpawnRequest, type HarnessSession } from './harness/index.js';
import type { BackendConfig } from './backends/types.js';
import { defaultBackendRegistry } from './harness/backend-registry.js';

// Re-export types from original agent-runner.ts to avoid duplication.
// Import from there to keep a single source of truth.
import type {
  AgentInstance,
  AgentProviderOptions,
  AgentSpawnOptions as BaseAgentSpawnOptions,
  ActivityReporter,
} from './agent-runner.js';

export type { AgentInstance, AgentProviderOptions, ActivityReporter };

/** Extended spawn options with backend selection */
export interface AgentSpawnOptions extends BaseAgentSpawnOptions {
  /** Which backend to use (defaults to 'claude-sdk') */
  backend?: 'claude-sdk' | 'openai-compat';
  /** Backend-specific config */
  backendConfig?: BackendConfig;
}

// Monorepo root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const MCP_SERVER_PATH = path.resolve(PROJECT_ROOT, 'packages/mcp/dist/index.js');

export class AgentRunnerV2 {
  private harness: AgentHarness;
  private agentInstances = new Map<string, AgentInstance>();

  constructor(
    reportActivity: ActivityReporter,
    flockServerUrl: string,
    dbPath?: string,
  ) {
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
      console.log(`[runner-v2] Agent ${agentId} already running, skipping spawn`);
      return this.agentInstances.get(agentId)!.sessionId;
    }

    if (!agentName) {
      agentName = `agent-${agentId.slice(0, 8)}`;
    }

    const sessionId = options?.sessionId ?? randomUUID();

    // Create backward-compatible AgentInstance
    const instance: AgentInstance = {
      agentId,
      agentName,
      sessionId,
      status: 'spawning',
      startedAt: new Date(),
      lastActiveAt: new Date(),
      prompt,
      agentToken,
      options,
    };
    this.agentInstances.set(agentId, instance);

    // Determine backend config
    const backendConfig: BackendConfig = options?.backendConfig
      ?? { type: options?.backend ?? 'claude-sdk', model: options?.model };

    // Build spawn request
    const request: SpawnRequest = {
      agentId,
      agentName,
      prompt,
      agentToken,
      backendConfig,
      model: options?.model,
      sessionId,
    };

    console.log(`[runner-v2] Spawning agent ${agentId} via harness (backend=${backendConfig.type})`);

    try {
      const session = await this.harness.spawn(request);

      // Update instance status when session starts
      instance.sessionId = session.sessionId;

      // Listen for state changes (fire-and-forget)
      session.promise.then((finalState) => {
        instance.status = finalState.status === 'completed' ? 'dormant' :
                          finalState.status === 'error' ? 'error' :
                          finalState.status === 'aborted' ? 'dormant' : 'error';
        if (finalState.status === 'completed' || finalState.status === 'aborted') {
          instance.abortController = undefined;
          this.agentInstances.delete(agentId);
        }
      }).catch(() => {
        instance.status = 'error';
        this.agentInstances.delete(agentId);
      });

      // Set status to active once we have a session
      instance.status = 'active';
      instance.abortController = session.abortController;

      return sessionId;
    } catch (err) {
      console.error(`[runner-v2] Failed to spawn agent ${agentId}:`, err);
      instance.status = 'error';
      this.agentInstances.delete(agentId);
      throw err;
    }
  }

  async stop(agentId: string): Promise<boolean> {
    const instance = this.agentInstances.get(agentId);
    if (!instance) return false;

    console.log(`[runner-v2] Stopping agent ${agentId}`);
    this.harness.abort(agentId);

    if (instance.abortController) {
      instance.abortController.abort();
    }

    instance.status = 'dormant';
    this.agentInstances.delete(agentId);

    return true;
  }

  async shutdown(): Promise<void> {
    console.log(`[runner-v2] Shutting down...`);
    await this.harness.shutdown();
    this.agentInstances.clear();
  }
}
