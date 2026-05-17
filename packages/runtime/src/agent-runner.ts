import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export interface AgentInstance {
  agentId: string;
  sessionId: string;
  status: 'spawning' | 'active' | 'dormant' | 'error';
  process: ChildProcess | null;
  startedAt: Date;
  lastActiveAt: Date;
  prompt: string;
}

export type ActivityReporter = (
  agentId: string,
  activityType: string,
  detail: string,
  metadata?: Record<string, unknown>,
) => Promise<void>;

export class AgentRunner {
  private agents: Map<string, AgentInstance> = new Map();
  private reportActivity: ActivityReporter;

  constructor(reportActivity: ActivityReporter) {
    this.reportActivity = reportActivity;
  }

  getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  isRunning(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    return agent !== undefined && agent.status === 'active';
  }

  async spawn(agentId: string, prompt: string): Promise<string> {
    if (this.isRunning(agentId)) {
      console.log(`[runner] Agent ${agentId} already running, skipping spawn`);
      return this.agents.get(agentId)!.sessionId;
    }

    const sessionId = randomUUID();
    const instance: AgentInstance = {
      agentId,
      sessionId,
      status: 'spawning',
      process: null,
      startedAt: new Date(),
      lastActiveAt: new Date(),
      prompt,
    };
    this.agents.set(agentId, instance);

    console.log(`[runner] Spawning agent ${agentId} with session ${sessionId}`);

    await this.reportActivity(agentId, 'status_change', 'Agent spawning', {
      session_id: sessionId,
    });

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
    });

    return true;
  }

  private async runAgent(instance: AgentInstance): Promise<void> {
    try {
      // Build the command to run Claude Code
      const args = [
        '-p', instance.prompt,
        '--output-format', 'text',
      ];

      console.log(`[runner] Starting: claude ${args.slice(0, 2).join(' ')}...`);

      const child = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Ensure the agent can access Flock MCP if configured
        },
      });

      instance.process = child;
      instance.status = 'active';
      instance.lastActiveAt = new Date();

      await this.reportActivity(instance.agentId, 'status_change', 'Agent active', {
        session_id: instance.sessionId,
        pid: child.pid,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
        instance.lastActiveAt = new Date();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        instance.lastActiveAt = new Date();
      });

      child.on('close', async (code) => {
        console.log(`[runner] Agent ${instance.agentId} exited with code ${code}`);

        if (code === 0) {
          instance.status = 'dormant';
          await this.reportActivity(instance.agentId, 'status_change', 'Agent completed', {
            session_id: instance.sessionId,
            exit_code: code,
            output_length: stdout.length,
          });
        } else {
          instance.status = 'error';
          await this.reportActivity(instance.agentId, 'error', `Agent exited with code ${code}`, {
            session_id: instance.sessionId,
            exit_code: code,
            stderr: stderr.slice(0, 1000),
          });
        }

        this.agents.delete(instance.agentId);
      });

      child.on('error', async (err) => {
        console.error(`[runner] Agent ${instance.agentId} process error:`, err);
        instance.status = 'error';
        await this.reportActivity(instance.agentId, 'error', `Process error: ${err.message}`, {
          session_id: instance.sessionId,
        });
        this.agents.delete(instance.agentId);
      });
    } catch (err) {
      console.error(`[runner] Failed to spawn agent ${instance.agentId}:`, err);
      instance.status = 'error';
      await this.reportActivity(instance.agentId, 'error', `Spawn failed: ${err}`, {
        session_id: instance.sessionId,
      });
      this.agents.delete(instance.agentId);
    }
  }

  async shutdown(): Promise<void> {
    console.log(`[runner] Shutting down ${this.agents.size} agents...`);
    const stops = Array.from(this.agents.keys()).map((id) => this.stop(id));
    await Promise.all(stops);
  }
}
