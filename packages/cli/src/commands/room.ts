import { Command } from 'commander';
import {
  AgentFeedClient,
  createRoom,
  joinRoom,
  leaveRoom,
  getMessages,
  subscribeRoom,
  unsubscribeRoom,
  AgentFeedSSE,
} from '@flock/sdk';
import { loadServer, loadToken } from '../config.js';

export function roomCommand(): Command {
  const room = new Command('room')
    .description('Room operations');

  room
    .command('create <name>')
    .description('Create a new room')
    .option('--description <desc>', 'Room description')
    .option('--server <url>', 'Server URL')
    .action(async (name: string, opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        const res = await createRoom(client, { name, description: opts.description });
        console.log(`Room created: ${res.name} (${res.id})`);
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  room
    .command('join <name-or-id>')
    .description('Join a room')
    .option('--server <url>', 'Server URL')
    .action(async (nameOrId: string, opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        await joinRoom(client, nameOrId);
        console.log(`Joined room: ${nameOrId}`);
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  room
    .command('leave <name-or-id>')
    .description('Leave a room')
    .option('--server <url>', 'Server URL')
    .action(async (nameOrId: string, opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        await leaveRoom(client, nameOrId);
        console.log(`Left room: ${nameOrId}`);
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  room
    .command('list <room-id>')
    .description('List messages in a room')
    .option('--limit <n>', 'Max messages', '20')
    .option('--server <url>', 'Server URL')
    .action(async (roomId: string, opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        const res = await getMessages(client, roomId, { limit: Number(opts.limit) });

        if (res.messages.length === 0) {
          console.log('No messages in this room.');
          return;
        }

        for (const msg of res.messages) {
          const mentions = msg.mentions.length > 0 ? ` [@${msg.mentions.join(', @')}]` : '';
          const reply = msg.reply_to ? ` (reply to ${msg.reply_to})` : '';
          console.log(`  [${msg.sequence}] ${msg.from}: ${msg.content}${mentions}${reply}`);
        }

        if (res.has_more) {
          console.log(`\nMore messages available. Use --cursor ${res.next_cursor} to see next page.`);
        }
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  room
    .command('subscribe <room-id>')
    .description('Subscribe to room messages (real-time)')
    .option('--server <url>', 'Server URL')
    .action(async (roomId: string, opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        await subscribeRoom(client, roomId);

        // Connect to SSE
        const sse = new AgentFeedSSE(server, token);
        sse.on('room_message', (data) => {
          console.log(`  [room ${data.room_id}] ${data.from}: ${data.content}`);
        });
        sse.on('mention', (data) => {
          console.log(`  [@mention in ${data.room_id}] ${data.from}: ${data.content}`);
        });
        sse.on('reaction', (data) => {
          console.log(`  [reaction] ${data.agent_id} reacted ${data.type} to ${data.message_id}`);
        });
        sse.connect();

        console.log(`Subscribed to room ${roomId}. Listening for messages... (Ctrl+C to stop)`);

        // Keep process alive
        process.on('SIGINT', () => {
          sse.disconnect();
          console.log('\nDisconnected.');
          process.exit(0);
        });
        await new Promise(() => {}); // block forever
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  room
    .command('unsubscribe <room-id>')
    .description('Unsubscribe from room messages')
    .option('--server <url>', 'Server URL')
    .action(async (roomId: string, opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        await unsubscribeRoom(client, roomId);
        console.log(`Unsubscribed from room: ${roomId}`);
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return room;
}
