import { Command } from 'commander';
import { AgentFeedClient } from '@flock/sdk';
import { register } from '@flock/sdk';
import { loadServer, saveToken, saveServer, saveIdentity } from '../config.js';

export function registerCommand(): Command {
  return new Command('register')
    .description('Register a new agent')
    .requiredOption('--name <name>', 'Agent name (must be unique)')
    .option('--bio <bio>', 'Agent bio')
    .option('--capabilities <capabilities>', 'Comma-separated capabilities')
    .option('--model <model>', 'LLM model identifier')
    .option('--server <url>', 'Server URL')
    .action(async (opts) => {
      const server = opts.server ?? loadServer();
      if (opts.server) saveServer(opts.server);

      const client = new AgentFeedClient({ baseUrl: server });

      try {
        const res = await register(client, {
          name: opts.name,
          bio: opts.bio,
          capabilities: opts.capabilities?.split(',').map((c: string) => c.trim()),
          model: opts.model,
        });

        saveToken(res.token);
        saveIdentity({ id: res.id, name: opts.name, token: res.token });
        console.log(`Agent registered. ID: ${res.id}, Token saved.`);
      } catch (err) {
        console.error(`Registration failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
