import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export interface AgentInstance {
  agentId: string;
  agentName: string;
  sessionId: string;
  status: 'spawning' | 'active' | 'dormant' | 'error';
  process: ChildProcess | null;
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

export class AgentRunner {
  private agents: Map<string, AgentInstance> = new Map();
  private reportActivity: ActivityReporter;
  private flockServerUrl: string;

  constructor(reportActivity: ActivityReporter, flockServerUrl: string) {
    this.reportActivity = reportActivity;
    this.flockServerUrl = flockServerUrl;
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
      process: null,
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

    if (instance.process && !instance.process.killed) {
      instance.process.kill('SIGTERM');
      // Force kill after 5 seconds
      setTimeout(() => {
        if (instance.process && !instance.process.killed) {
          instance.process.kill('SIGKILL');
        }
      }, 5000);
    }

    instance.status = 'dormant';
    this.agents.delete(agentId);

    await this.reportActivity(agentId, 'status_change', 'Agent stopped', {
      session_id: instance.sessionId,
    }, instance.agentToken);

    return true;
  }

  private async runAgent(instance: AgentInstance): Promise<void> {
    try {
      // Build the command to run Claude Code
      const args: string[] = [
        '-p', instance.prompt,
        '--output-format', 'text',
      ];
      const provider = normalizeProvider(instance.options?.provider);
      const resumeSession = Boolean(instance.options?.sessionId);

      args.push(resumeSession ? '--resume' : '--session-id', instance.sessionId);

      if (instance.options?.model) {
        args.push('--model', instance.options.model);
      }
      if (provider?.env && Object.keys(provider.env).length > 0) {
        args.push('--settings', JSON.stringify({ env: provider.env }));
      }

      console.log(`[runner] Starting Claude session ${instance.sessionId} (${resumeSession ? 'resume' : 'new'})`);

      const child = spawn('claude', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // AGENT_NAME tells the MCP server to use ~/.flock/agents/{name}/identity.json
          // instead of the global ~/.flock/identity.json
          AGENT_NAME: instance.agentName,
          AGENT_PROVIDER: provider?.name ?? 'default',
          // AGENT_TOKEN lets the MCP server authenticate as the correct agent
          ...(instance.agentToken ? { AGENT_TOKEN: instance.agentToken } : {}),
        },
      });

      instance.process = child;
      let stdout = '';
      let stderr = '';
      let finished = false;

      const reportError = (label: string, err: unknown) => {
        console.error(`[runner] ${label} for ${instance.agentId}:`, err);
        return this.reportActivity(instance.agentId, 'error', `${label}: ${formatError(err)}`, {
          session_id: instance.sessionId,
        }, instance.agentToken);
      };

      const completeOnce = (): boolean => {
        if (finished) return false;
        finished = true;
        this.agents.delete(instance.agentId);
        return true;
      };

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
        instance.lastActiveAt = new Date();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        instance.lastActiveAt = new Date();
      });

      child.once('spawn', () => {
        if (finished) return;
        instance.status = 'active';
        instance.lastActiveAt = new Date();

        void this.reportActivity(instance.agentId, 'status_change', 'Agent active', {
          session_id: instance.sessionId,
          session_source: 'claude-cli',
          pid: child.pid,
        }, instance.agentToken).catch((err) => {
          console.error(`[runner] Failed to report active for ${instance.agentId}:`, err);
        });
      });

      child.once('close', (code) => {
        if (!completeOnce()) return;
        console.log(`[runner] Agent ${instance.agentId} exited with code ${code}`);

        if (code === 0) {
          instance.status = 'dormant';
          void this.reportActivity(instance.agentId, 'status_change', 'Agent completed', {
            session_id: instance.sessionId,
            exit_code: code,
            output_length: stdout.length,
          }, instance.agentToken).catch((err) => {
            console.error(`[runner] Failed to report completion for ${instance.agentId}:`, err);
          });
        } else {
          instance.status = 'error';
          const stdoutTail = tail(stdout);
          const stderrTail = tail(stderr);
          const summary = summarizeFailure(stdoutTail, stderrTail);
          void this.reportActivity(instance.agentId, 'error', `Agent exited with code ${code}${summary ? `: ${summary}` : ''}`, {
            session_id: instance.sessionId,
            exit_code: code,
            stdout: stdoutTail,
            stderr: stderrTail,
          }, instance.agentToken).catch((err) => {
            console.error(`[runner] Failed to report exit for ${instance.agentId}:`, err);
          });
        }
      });

      child.once('error', (err) => {
        if (!completeOnce()) return;
        instance.status = 'error';
        void reportError('Process error', err).catch((reportErr) => {
          console.error(`[runner] Failed to report process error for ${instance.agentId}:`, reportErr);
        });
      });
    } catch (err) {
      console.error(`[runner] Failed to spawn agent ${instance.agentId}:`, err);
      instance.status = 'error';
      await this.reportActivity(instance.agentId, 'error', `Spawn failed: ${formatError(err)}`, {
        session_id: instance.sessionId,
      }, instance.agentToken);
      this.agents.delete(instance.agentId);
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

function tail(value: string, max = 4000): string {
  return value.length > max ? value.slice(value.length - max) : value;
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function summarizeFailure(stdout: string, stderr: string): string {
  const combined = `${stdout}\n${stderr}`;
  const lines = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const priority = lines.find((line) => /API Error|Failed to authenticate|Error:/i.test(line));
  return (priority ?? lines[0] ?? '').slice(0, 300);
}
