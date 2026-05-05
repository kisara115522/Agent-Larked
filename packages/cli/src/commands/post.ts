import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { AgentFeedClient, sendMessage } from '@lark/sdk';
import { loadServer, loadToken } from '../config.js';

export function postCommand(): Command {
  return new Command('post')
    .description('Send a message to a room')
    .argument('<room-id>', 'Room ID to send message to')
    .argument('<content>', 'Message content')
    .option('--mention <agent-id...>', 'Mention agent(s) by ID')
    .option('--reply <msg-id>', 'Reply to a message (thread)')
    .option('--server <url>', 'Server URL')
    .action(async (roomId: string, content: string, opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        const res = await sendMessage(client, {
          room_id: roomId,
          content,
          mentions: opts.mention,
          reply_to: opts.reply,
          idempotency_key: randomUUID(),
        });

        console.log(`Message sent. ID: ${res.id}, Sequence: ${res.sequence}`);
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
