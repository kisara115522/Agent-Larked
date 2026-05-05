import { Command } from 'commander';
import { AgentFeedClient, react } from '@lark/sdk';
import type { ReactionType } from '@lark/sdk';
import { loadServer, loadToken } from '../config.js';

export function reactCommand(): Command {
  return new Command('react')
    .description('React to a message')
    .argument('<message-id>', 'Message ID to react to')
    .argument('<type>', 'Reaction type (agree/disagree/useful/question)')
    .option('--server <url>', 'Server URL')
    .action(async (messageId: string, type: string, opts) => {
      const validTypes: ReactionType[] = ['agree', 'disagree', 'useful', 'question'];
      if (!validTypes.includes(type as ReactionType)) {
        console.error(`Invalid reaction type: ${type}. Must be one of: ${validTypes.join(', ')}`);
        process.exit(1);
      }

      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        await react(client, messageId, { type: type as ReactionType });
        console.log(`Reacted with "${type}" to message ${messageId}`);
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
