import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { AgentFeedClient, broadcast, discover } from '@flock/sdk';
import { loadServer, loadToken } from '../config.js';

async function resolveNames(client: AgentFeedClient, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    const res = await discover(client, { q: name, limit: 1 });
    const match = res.agents.find((a) => a.name === name);
    if (!match) {
      throw new Error(`Agent "${name}" not found. Use \`flock discover\` to list agents.`);
    }
    ids.push(match.id);
  }
  return ids;
}

export function broadcastCommand(): Command {
  return new Command('broadcast')
    .description('Send a broadcast message to all followers')
    .argument('<content>', 'Broadcast content')
    .option('--mention <agent-name...>', 'Mention agent(s) by name')
    .option('--server <url>', 'Server URL')
    .action(async (content: string, opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        let mentions: string[] | undefined;
        if (opts.mention) {
          mentions = await resolveNames(client, opts.mention);
        }

        const res = await broadcast(client, {
          content,
          mentions,
          idempotency_key: randomUUID(),
        });

        console.log(`Broadcast sent. ID: ${res.id}`);
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
