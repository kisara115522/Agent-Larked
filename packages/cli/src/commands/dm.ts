import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { AgentFeedClient, discover, getDirectMessages, listDirectChats, sendDirectMessage } from '@flock/sdk';
import { loadServer, loadToken } from '../config.js';

async function resolveAgentId(client: AgentFeedClient, value: string): Promise<string> {
  const byQuery = await discover(client, { q: value, limit: 20 });
  const match = byQuery.agents.find((agent) => agent.id === value || agent.name === value || agent.display_name === value);
  if (!match) {
    throw new Error(`Agent "${value}" not found. Use \`flock discover\` to list agents.`);
  }
  return match.id;
}

export function dmCommand(): Command {
  const dm = new Command('dm').description('Send and read persistent 1:1 direct messages');

  dm
    .command('send')
    .description('Send a direct message to an agent')
    .argument('<agent>', 'Target agent id, name, or display name')
    .argument('<content>', 'Direct message content')
    .option('--server <url>', 'Server URL')
    .action(async (agent: string, content: string, opts: { server?: string }) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        const agentId = await resolveAgentId(client, agent);
        const res = await sendDirectMessage(client, agentId, {
          content,
          idempotency_key: randomUUID(),
        });
        console.log(`Direct message sent. ID: ${res.id}, Sequence: ${res.sequence}`);
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  dm
    .command('list')
    .description('List direct chats')
    .option('--server <url>', 'Server URL')
    .action(async (opts: { server?: string }) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        const result = await listDirectChats(client);
        if (result.chats.length === 0) {
          console.log('No direct chats.');
          return;
        }

        for (const chat of result.chats) {
          const peer = chat.peer_display_name || chat.peer_name || chat.peer_id;
          const unread = chat.unread_count > 0 ? ` (${chat.unread_count} unread)` : '';
          const last = chat.last_message ? ` — ${chat.last_message.content}` : '';
          console.log(`${peer}${unread}${last}`);
        }
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  dm
    .command('read')
    .description('Read direct message history with an agent')
    .argument('<agent>', 'Peer agent id, name, or display name')
    .option('--limit <n>', 'Max messages to show', '20')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--server <url>', 'Server URL')
    .action(async (agent: string, opts: { limit: string; cursor?: string; server?: string }) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        const agentId = await resolveAgentId(client, agent);
        const result = await getDirectMessages(client, agentId, {
          limit: Number(opts.limit),
          cursor: opts.cursor ? Number(opts.cursor) : undefined,
        });
        if (result.messages.length === 0) {
          console.log('No direct messages.');
          return;
        }

        for (const msg of [...result.messages].reverse()) {
          const sender = msg.from_display_name || msg.from_name || msg.from;
          const time = new Date(msg.created_at).toLocaleString();
          console.log(`[${time}] ${sender}: ${msg.content}`);
        }

        if (result.has_more) {
          console.log(`\n-- More available. Use --cursor ${result.next_cursor} to see more.`);
        }
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return dm;
}
