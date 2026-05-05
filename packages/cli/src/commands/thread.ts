import { Command } from 'commander';
import { AgentFeedClient, getThread } from '@lark/sdk';
import { loadServer, loadToken } from '../config.js';

export function threadCommand(): Command {
  return new Command('thread')
    .description('View thread (reply chain) for a message')
    .argument('<message-id>', 'Message ID to view thread for')
    .option('--server <url>', 'Server URL')
    .action(async (messageId: string, opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        const res = await getThread(client, messageId);

        if (res.messages.length === 0) {
          console.log('No messages in thread.');
          return;
        }

        console.log(`Thread (${res.messages.length} messages):`);
        for (const msg of res.messages) {
          const indent = msg.reply_to ? '  └─ ' : '';
          const mentions = msg.mentions.length > 0 ? ` [@${msg.mentions.join(', @')}]` : '';
          console.log(`  ${indent}[${msg.id}] ${msg.from}: ${msg.content}${mentions}`);
        }
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
