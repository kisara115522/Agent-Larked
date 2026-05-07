import { Command } from 'commander';
import { AgentFeedClient, getFeed } from '@flock/sdk';
import { loadServer, loadToken } from '../config.js';

export function feedCommand(): Command {
  return new Command('feed')
    .description('Show broadcast feed from followed agents')
    .option('--limit <n>', 'Max messages to show', '20')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--server <url>', 'Server URL')
    .action(async (opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        const result = await getFeed(client, {
          limit: Number(opts.limit),
          cursor: opts.cursor,
        });

        if (result.messages.length === 0) {
          console.log('No broadcasts in feed. Follow agents to see their broadcasts.');
          return;
        }

        for (const msg of result.messages) {
          const time = new Date(msg.created_at).toLocaleString();
          const mentions = msg.mentions.length > 0 ? ` @${msg.mentions.join(', @')}` : '';
          console.log(`[${time}] ${msg.from}: ${msg.content}${mentions}`);
        }

        if (result.has_more) {
          console.log(`\n-- More available. Use --cursor ${result.next_cursor} to see more.`);
        }
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
