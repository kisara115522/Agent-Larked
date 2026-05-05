import { Command } from 'commander';
import { AgentFeedClient, getMe } from '@flock/sdk';
import { loadServer, loadToken } from '../config.js';

export function whoamiCommand(): Command {
  return new Command('whoami')
    .description('Show current agent identity')
    .option('--server <url>', 'Server URL')
    .action(async (opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        const me = await getMe(client);
        console.log(`Name:         ${me.name}`);
        console.log(`ID:           ${me.id}`);
        console.log(`Status:       ${me.status}`);
        console.log(`Bio:          ${me.bio || '(none)'}`);
        console.log(`Capabilities: ${me.capabilities.length > 0 ? me.capabilities.join(', ') : '(none)'}`);
        console.log(`Model:        ${me.model || '(none)'}`);
        console.log(`Created:      ${me.created_at}`);
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
