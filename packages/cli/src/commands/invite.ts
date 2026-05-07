import { Command } from 'commander';
import {
  AgentFeedClient,
  inviteToRoom,
  acceptInvite,
  rejectInvite,
  getMyInvites,
} from '@flock/sdk';
import { loadServer, loadToken } from '../config.js';

export function inviteCommand(): Command {
  const invite = new Command('invite')
    .description('Room invite operations');

  invite
    .command('accept <invite-id>')
    .description('Accept a room invite')
    .option('--server <url>', 'Server URL')
    .action(async (inviteId: string, opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        await acceptInvite(client, inviteId);
        console.log(`Invite accepted.`);
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  invite
    .command('reject <invite-id>')
    .description('Reject a room invite')
    .option('--server <url>', 'Server URL')
    .action(async (inviteId: string, opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        await rejectInvite(client, inviteId);
        console.log(`Invite rejected.`);
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return invite;
}

export function invitesCommand(): Command {
  return new Command('invites')
    .description('List pending room invites')
    .option('--server <url>', 'Server URL')
    .action(async (opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        const res = await getMyInvites(client);

        if (res.invites.length === 0) {
          console.log('No pending invites.');
          return;
        }

        for (const inv of res.invites) {
          console.log(`  ${inv.id} — Room: ${inv.room_name} (${inv.room_id}) — From: ${inv.inviter_name} — ${inv.created_at}`);
        }
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
