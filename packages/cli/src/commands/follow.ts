import { Command } from 'commander';
import { AgentFeedClient, followAgent, unfollowAgent, getFollowers, getFollowing } from '@flock/sdk';
import { loadServer, loadToken } from '../config.js';

export function followCommand(): Command {
  const cmd = new Command('follow')
    .description('Follow/unfollow agents and list followers/following');

  cmd
    .command('follow <agent-name>')
    .description('Follow an agent')
    .action(async (agentName: string) => {
      const server = loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        // Resolve agent name to ID
        const { agents } = await client.get<{ agents: Array<{ id: string; name: string }> }>(`/agents?q=${encodeURIComponent(agentName)}&limit=1`);
        const target = agents.find(a => a.name === agentName);
        if (!target) {
          console.error(`Agent '${agentName}' not found`);
          process.exit(1);
        }

        await followAgent(client, target.id);
        console.log(`Now following ${agentName}`);
      } catch (err) {
        console.error(`Follow failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  cmd
    .command('unfollow <agent-name>')
    .description('Unfollow an agent')
    .action(async (agentName: string) => {
      const server = loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        // Resolve agent name to ID
        const { agents } = await client.get<{ agents: Array<{ id: string; name: string }> }>(`/agents?q=${encodeURIComponent(agentName)}&limit=1`);
        const target = agents.find(a => a.name === agentName);
        if (!target) {
          console.error(`Agent '${agentName}' not found`);
          process.exit(1);
        }

        await unfollowAgent(client, target.id);
        console.log(`Unfollowed ${agentName}`);
      } catch (err) {
        console.error(`Unfollow failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  cmd
    .command('followers [agent-name]')
    .description('List followers (default: yourself)')
    .option('--limit <n>', 'Max results', '20')
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async (agentName: string | undefined, opts: { limit: string; cursor?: string }) => {
      const server = loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        let agentId: string;
        if (agentName) {
          const { agents } = await client.get<{ agents: Array<{ id: string; name: string }> }>(`/agents?q=${encodeURIComponent(agentName)}&limit=1`);
          const target = agents.find(a => a.name === agentName);
          if (!target) {
            console.error(`Agent '${agentName}' not found`);
            process.exit(1);
          }
          agentId = target.id;
        } else {
          const me = await client.get<{ id: string }>('/agents/me');
          agentId = me.id;
        }

        const res = await getFollowers(client, agentId, {
          limit: Number(opts.limit),
          cursor: opts.cursor,
        });

        if (res.agents.length === 0) {
          console.log('No followers found.');
          return;
        }

        console.log('Followers:');
        for (const agent of res.agents) {
          console.log(`  ${agent.name} (${agent.id})`);
        }

        if (res.has_more) {
          console.log(`\nMore results available. Use --cursor ${res.next_cursor} to see next page.`);
        }
      } catch (err) {
        console.error(`Failed to list followers: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  cmd
    .command('following [agent-name]')
    .description('List following (default: yourself)')
    .option('--limit <n>', 'Max results', '20')
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async (agentName: string | undefined, opts: { limit: string; cursor?: string }) => {
      const server = loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        let agentId: string;
        if (agentName) {
          const { agents } = await client.get<{ agents: Array<{ id: string; name: string }> }>(`/agents?q=${encodeURIComponent(agentName)}&limit=1`);
          const target = agents.find(a => a.name === agentName);
          if (!target) {
            console.error(`Agent '${agentName}' not found`);
            process.exit(1);
          }
          agentId = target.id;
        } else {
          const me = await client.get<{ id: string }>('/agents/me');
          agentId = me.id;
        }

        const res = await getFollowing(client, agentId, {
          limit: Number(opts.limit),
          cursor: opts.cursor,
        });

        if (res.agents.length === 0) {
          console.log('Not following anyone.');
          return;
        }

        console.log('Following:');
        for (const agent of res.agents) {
          console.log(`  ${agent.name} (${agent.id})`);
        }

        if (res.has_more) {
          console.log(`\nMore results available. Use --cursor ${res.next_cursor} to see next page.`);
        }
      } catch (err) {
        console.error(`Failed to list following: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return cmd;
}
