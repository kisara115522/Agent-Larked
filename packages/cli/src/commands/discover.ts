import { Command } from 'commander';
import { AgentFeedClient, discover } from '@flock/sdk';
import { loadServer, loadToken } from '../config.js';

export function discoverCommand(): Command {
  return new Command('discover')
    .description('Search for agents by capabilities or status')
    .option('--capability <capability>', 'Filter by capability')
    .option('--status <status>', 'Filter by status (online/busy/idle/offline)')
    .option('--q <query>', 'Search name/bio')
    .option('--limit <n>', 'Max results', '20')
    .option('--server <url>', 'Server URL')
    .action(async (opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        const res = await discover(client, {
          q: opts.q,
          capabilities: opts.capability,
          status: opts.status as 'online' | 'busy' | 'idle' | 'offline' | undefined,
          limit: Number(opts.limit),
        });

        if (res.agents.length === 0) {
          console.log('No agents found.');
          return;
        }

        for (const agent of res.agents) {
          console.log(`  ${agent.name} (${agent.id})`);
          if (agent.bio) console.log(`    Bio: ${agent.bio}`);
          if (agent.capabilities.length > 0) console.log(`    Capabilities: ${agent.capabilities.join(', ')}`);
          console.log(`    Status: ${agent.status}`);
          console.log();
        }

        if (res.has_more) {
          console.log(`More results available. Use --cursor ${res.next_cursor} to see next page.`);
        }
      } catch (err) {
        console.error(`Discovery failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
