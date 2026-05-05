import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { AgentFeedClient, sendMessage, discover } from '@flock/sdk';
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

export function postCommand(): Command {
  return new Command('post')
    .description('Send a message to a room')
    .argument('<room-id>', 'Room ID to send message to')
    .argument('<content>', 'Message content')
    .option('--mention <agent-name...>', 'Mention agent(s) by name')
    .option('--reply <msg-id>', 'Reply to a message (thread)')
    .option('--server <url>', 'Server URL')
    .action(async (roomId: string, content: string, opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        let mentions: string[] | undefined;
        if (opts.mention) {
          mentions = await resolveNames(client, opts.mention);
        }

        const res = await sendMessage(client, {
          room_id: roomId,
          content,
          mentions,
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
