import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, type SDKMessage, type Query } from '@anthropic-ai/claude-agent-sdk';

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
}

export type ActivityReporter = (
  agentId: string,
  activityType: string,
  detail: string,
  metadata?: Record<string, unknown>,
  agentToken?: string,
) => Promise<void>;

// Monorepo root — works from both src/ and dist/
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const MCP_SERVER_PATH = path.resolve(PROJECT_ROOT, 'packages/mcp/dist/index.js');

export class AgentRunner {
  private agents: Map<string, AgentInstance> = new Map();
  private reportActivity: ActivityReporter;
  private flockServerUrl: string;
  private dbPath: string;

  constructor(reportActivity: ActivityReporter, flockServerUrl: string, dbPath?: string) {
    this.reportActivity = reportActivity;
    this.flockServerUrl = flockServerUrl;
    this.dbPath = dbPath || path.resolve(PROJECT_ROOT, 'data/agentfeed.db');
  }

  /** Fetch agent name from Flock server by agent ID */
  private async fetchAgentName(agentId: string): Promise<string> {
    try {
      const res = await fetch(`${this.flockServerUrl}/agents/${agentId}`);
      if (res.ok) {
        const profile = (await res.json()) as { name: string };
        return profile.name;
      }
    } catch (err) {
      console.error(`[runner] Failed to fetch agent name for ${agentId}:`, err);
    }
    return `agent-${agentId.slice(0, 8)}`;
  }

  getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  isRunning(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    return agent !== undefined && (agent.status === 'spawning' || agent.status === 'active');
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
      return this.agents.get(agentId)!.sessionId;
    }

    // Use agent name from callback, or fall back to fetch
    if (!agentName) {
      agentName = await this.fetchAgentName(agentId);
    }
    console.log(`[runner] Agent ${agentId} resolved to name: ${agentName}`);

    const sessionId = options?.sessionId ?? randomUUID();
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
    this.agents.set(agentId, instance);

    console.log(`[runner] Spawning agent ${agentId} with session ${sessionId}`);

    await this.reportActivity(agentId, 'status_change', 'Agent spawning', {
      session_id: sessionId,
    }, agentToken);

    // Run async — don't await, let it run in background
    this.runAgent(instance);

    return sessionId;
  }

  async stop(agentId: string): Promise<boolean> {
    const instance = this.agents.get(agentId);
    if (!instance) {
      console.log(`[runner] Agent ${agentId} not found`);
      return false;
    }

    console.log(`[runner] Stopping agent ${agentId}`);

    // Abort the SDK query
    if (instance.abortController) {
      instance.abortController.abort();
      instance.abortController = undefined;
    }

    instance.status = 'dormant';
    this.agents.delete(agentId);

    await this.reportActivity(agentId, 'status_change', 'Agent stopped', {
      session_id: instance.sessionId,
    }, instance.agentToken);

    return true;
  }

  private async runAgent(instance: AgentInstance): Promise<void> {
    const provider = normalizeProvider(instance.options?.provider);
    const isResume = Boolean(instance.options?.sessionId);

    console.log(`[runner] Starting agent ${instance.agentId} via SDK (${isResume ? 'resume' : 'new'})`);

    const abortController = new AbortController();
    instance.abortController = abortController;

    try {
      const result: Query = query({
        prompt: instance.prompt,
        options: {
          cwd: PROJECT_ROOT,
          allowedTools: [
            'Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'WebFetch',
            'mcp__flock__',
          ],
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          abortController,
          model: instance.options?.model,
          env: provider?.env
            ? { ...process.env, ...provider.env }
            : process.env as Record<string, string | undefined>,
          mcpServers: {
            flock: {
              command: 'node',
              args: [MCP_SERVER_PATH],
              env: {
                DB_PATH: this.dbPath,
                AGENT_NAME: instance.agentName,
                ...(instance.agentToken ? { AGENT_TOKEN: instance.agentToken } : {}),
                ...(provider?.name ? { AGENT_PROVIDER: provider.name } : {}),
              },
            },
          },
          settingSources: [],
          ...(isResume ? { resume: instance.options!.sessionId } : {}),
        },
      });

      // Track session state
      let gotInit = false;

      for await (const message of result) {
        instance.lastActiveAt = new Date();

        // Init message — SDK has started, extract session_id
        if (message.type === 'system' && message.subtype === 'init') {
          gotInit = true;
          instance.sessionId = message.session_id;
          instance.status = 'active';

          console.log(`[runner] Agent ${instance.agentId} active, session ${message.session_id}, model ${message.model}`);

          void this.reportActivity(instance.agentId, 'status_change', 'Agent active', {
            session_id: message.session_id,
            session_source: 'agent-sdk',
            model: message.model,
            tools: message.tools?.length ?? 0,
            mcp_servers: message.mcp_servers?.map(s => `${s.name}:${s.status}`).join(', ') ?? '',
          }, instance.agentToken).catch((err) => {
            console.error(`[runner] Failed to report active for ${instance.agentId}:`, err);
          });
        }

        // Result message — agent finished
        if (message.type === 'result') {
          instance.sessionId = message.session_id;

          if (message.subtype === 'error_during_execution' || message.subtype === 'error_max_turns' || message.subtype === 'error_max_budget_usd') {
            instance.status = 'error';
            this.agents.delete(instance.agentId);
            console.error(`[runner] Agent ${instance.agentId} error (${message.subtype})`);
            void this.reportActivity(instance.agentId, 'error', `Agent error: ${message.subtype}`, {
              session_id: message.session_id,
              duration_ms: message.duration_ms,
              cost_usd: message.total_cost_usd,
            }, instance.agentToken).catch((err) => {
              console.error(`[runner] Failed to report error for ${instance.agentId}:`, err);
            });
          } else {
            // Agent completed normally — mark dormant (can be woken)
            instance.status = 'dormant';
            instance.abortController = undefined;
            console.log(`[runner] Agent ${instance.agentId} completed, marked dormant`);
            void this.reportActivity(instance.agentId, 'status_change', 'Agent dormant (completed)', {
              session_id: message.session_id,
              duration_ms: message.duration_ms,
              cost_usd: message.total_cost_usd,
              num_turns: message.num_turns,
            }, instance.agentToken).catch((err) => {
              console.error(`[runner] Failed to report completion for ${instance.agentId}:`, err);
            });
          }
        }
      }

      // If we never got an init message, something went wrong
      if (!gotInit) {
        console.warn(`[runner] Agent ${instance.agentId} finished without init message`);
        instance.status = 'error';
        this.agents.delete(instance.agentId);
        void this.reportActivity(instance.agentId, 'error', 'Agent finished without init message', {
          session_id: instance.sessionId,
        }, instance.agentToken).catch(() => {});
      }
    } catch (err) {
      // AbortError is expected when stop() is called
      if (err instanceof Error && err.name === 'AbortError') {
        console.log(`[runner] Agent ${instance.agentId} aborted`);
        instance.status = 'dormant';
        instance.abortController = undefined;
        return;
      }

      console.error(`[runner] Failed to run agent ${instance.agentId}:`, err);
      instance.status = 'error';
      this.agents.delete(instance.agentId);
      void this.reportActivity(instance.agentId, 'error', `Run failed: ${formatError(err)}`, {
        session_id: instance.sessionId,
      }, instance.agentToken).catch((reportErr) => {
        console.error(`[runner] Failed to report run error for ${instance.agentId}:`, reportErr);
      });
    }
  }

  async shutdown(): Promise<void> {
    console.log(`[runner] Shutting down ${this.agents.size} agents...`);
    const stops = Array.from(this.agents.keys()).map((id) => this.stop(id));
    await Promise.all(stops);
  }
}

function normalizeProvider(provider: AgentSpawnOptions['provider']): AgentProviderOptions | undefined {
  if (!provider) return undefined;
  if (typeof provider === 'string') {
    return { name: provider };
  }
  return {
    name: provider.name ?? 'custom',
    env: sanitizeEnv(provider.env),
  };
}

function sanitizeEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!env) return undefined;
  const cleanEntries = Object.entries(env).filter(([key, value]) => {
    return /^[A-Z_][A-Z0-9_]*$/.test(key) && typeof value === 'string';
  });
  return cleanEntries.length > 0 ? Object.fromEntries(cleanEntries) : undefined;
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
