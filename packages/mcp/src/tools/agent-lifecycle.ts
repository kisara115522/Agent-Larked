import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { notifyRuntimeSpawn, notifyRuntimeStop } from '@flock/server/services/callback';
import { regenerateToken } from '@flock/server/services/identity';
import { getAgentId } from '../db.js';

export function registerAgentLifecycleTools(
  server: McpServer,
  db: Database.Database,
  agentIdProvider: () => string | null = getAgentId,
): void {
  server.tool(
    'flock_agent_spawn',
    'Start an agent instance on a Runtime. Creates a spawn record and notifies the Runtime to launch the agent process.',
    {
      agent_id: z.string().describe('ID of the agent to spawn'),
      prompt: z.string().optional().describe('Initial prompt/instructions for the agent'),
      runtime_id: z.string().optional().describe('Specific Runtime ID to use (auto-selects if omitted)'),
      room_id: z.string().optional().describe('Target room ID for the agent to join on spawn'),
    },
    async (args) => {
      try {
        const existing = db.prepare('SELECT id, name, status FROM profiles WHERE id = ?').get(args.agent_id) as { id: string; name: string; status: string } | undefined;
        if (!existing) {
          return { content: [{ type: 'text' as const, text: 'Error: Agent not found.' }], isError: true };
        }

        const now = new Date().toISOString();
        let runtimeId = args.runtime_id ?? null;

        // Auto-select an online runtime if none specified
        if (!runtimeId) {
          const runtime = db.prepare(`
            SELECT r.id FROM agent_runtimes r
            WHERE r.status = 'online'
            AND (SELECT COUNT(*) FROM agent_spawns s WHERE s.runtime_id = r.id AND s.status IN ('active', 'spawning')) < r.max_agents
            ORDER BY r.last_heartbeat_at DESC
            LIMIT 1
          `).get() as { id: string } | undefined;
          if (runtime) runtimeId = runtime.id;
        }

        if (!runtimeId) {
          return { content: [{ type: 'text' as const, text: 'Error: No online runtime available. Start a runtime daemon first.' }], isError: true };
        }

        const spawnId = randomUUID();
        db.prepare(`
          INSERT INTO agent_spawns (id, agent_id, runtime_id, status, spawned_at, last_active_at, prompt)
          VALUES (?, ?, ?, 'spawning', ?, ?, ?)
        `).run(spawnId, args.agent_id, runtimeId, now, now, args.prompt ?? null);

        db.prepare("UPDATE profiles SET status = 'spawning', updated_at = ? WHERE id = ?").run(now, args.agent_id);

        // Look up room name if room_id provided
        let roomName: string | undefined;
        if (args.room_id) {
          const room = db.prepare('SELECT name FROM rooms WHERE id = ?').get(args.room_id) as { name: string } | undefined;
          roomName = room?.name;
        }

        const { token } = regenerateToken(db, args.agent_id);
        notifyRuntimeSpawn(db, runtimeId, args.agent_id, args.prompt ?? undefined, token, args.room_id, roomName);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ spawn_id: spawnId, agent_id: args.agent_id, runtime_id: runtimeId, status: 'spawning', agent_token: token }) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );

  server.tool(
    'flock_agent_stop',
    'Stop a running agent instance. Marks spawns as stopped and notifies the Runtime.',
    {
      agent_id: z.string().describe('ID of the agent to stop'),
    },
    async (args) => {
      try {
        const existing = db.prepare('SELECT id FROM profiles WHERE id = ?').get(args.agent_id) as { id: string } | undefined;
        if (!existing) {
          return { content: [{ type: 'text' as const, text: 'Error: Agent not found.' }], isError: true };
        }

        const now = new Date().toISOString();

        const activeSpawn = db.prepare(
          "SELECT runtime_id FROM agent_spawns WHERE agent_id = ? AND status IN ('active', 'spawning') ORDER BY spawned_at DESC LIMIT 1",
        ).get(args.agent_id) as { runtime_id: string | null } | undefined;

        db.prepare("UPDATE agent_spawns SET status = 'stopped', last_active_at = ? WHERE agent_id = ? AND status IN ('active', 'spawning')").run(now, args.agent_id);

        if (activeSpawn?.runtime_id) {
          notifyRuntimeStop(db, activeSpawn.runtime_id, args.agent_id);
        }

        db.prepare("UPDATE profiles SET status = 'dormant', updated_at = ? WHERE id = ?").run(now, args.agent_id);

        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, agent_id: args.agent_id, status: 'dormant' }) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );

  server.tool(
    'flock_agent_status',
    'Get the runtime status of an agent (active/dormant/error, runtime ID, session ID).',
    {
      agent_id: z.string().describe('ID of the agent to check'),
    },
    async (args) => {
      try {
        const profile = db.prepare('SELECT status, last_active_at FROM profiles WHERE id = ?').get(args.agent_id) as { status: string; last_active_at: string | null } | undefined;
        if (!profile) {
          return { content: [{ type: 'text' as const, text: 'Error: Agent not found.' }], isError: true };
        }

        const spawn = db.prepare(
          "SELECT runtime_id, session_id FROM agent_spawns WHERE agent_id = ? AND status IN ('active', 'spawning') ORDER BY spawned_at DESC LIMIT 1",
        ).get(args.agent_id) as { runtime_id: string | null; session_id: string | null } | undefined;

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              agent_id: args.agent_id,
              status: profile.status,
              runtime_id: spawn?.runtime_id ?? null,
              session_id: spawn?.session_id ?? null,
              last_active_at: profile.last_active_at,
            }),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );
}
