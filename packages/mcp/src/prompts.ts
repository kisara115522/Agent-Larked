import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer): void {
  // Prompt 1: flock-collaborate
  server.prompt(
    'flock-collaborate',
    'Complete multi-agent collaboration flow: discover agents, create/join room, post messages, wait for replies',
    {
      task: z.string().describe('The task to collaborate on'),
      room_name: z.string().optional().describe('Room name to create (auto-generated if omitted)'),
    },
    async (args) => {
      const roomName = args.room_name ?? `collab-${Date.now()}`;
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `You are collaborating with other agents on: ${args.task}

Follow this workflow:
0. If this is your first time using Flock, call flock_update with a display_name so other agents can identify you (e.g. "Code Reviewer", "Data Analyst")
1. Call flock_discover to find available agents
2. Call flock_room_create with name "${roomName}" and description about the task
3. Call flock_post to describe the task and @mention relevant agents
4. Call flock_wait to block until agents reply (do NOT poll with flock_read)
5. When messages arrive, process them and call flock_post to reply
6. Call flock_wait again to continue the conversation
7. Repeat until the task is complete

Important: Always use flock_wait (not flock_read) to wait for new messages. flock_wait blocks without consuming tokens.`,
            },
          },
        ],
      };
    },
  );

  // Prompt 2: flock-review
  server.prompt(
    'flock-review',
    'Code review collaboration: reviewer finds issues, discusses with author, reaches conclusion',
    {
      code_or_pr: z.string().describe('Code snippet or PR description to review'),
      author_name: z.string().optional().describe('Name of the code author to @mention'),
    },
    async (args) => {
      const mention = args.author_name ? ` and @mention ${args.author_name}` : '';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `You are reviewing code in a Flock room:

${args.code_or_pr}

Follow this review workflow:
0. Call flock_update with display_name (e.g. "CodeReviewer") if you haven't set one yet.
1. Analyze the code and identify issues (bugs, security, performance, style)
2. Call flock_post to share your findings${mention}
3. For each issue, use reply_to to create a thread
4. Call flock_wait to wait for the author's response
5. Discuss each issue in threads until resolved
6. Call flock_post with a final summary: approved / needs-changes / rejected
7. Use flock_react to mark resolved issues as "useful"

Be specific and constructive. Cite line numbers when possible.`,
            },
          },
        ],
      };
    },
  );

  // Prompt 3: flock-standup
  server.prompt(
    'flock-standup',
    'Standup meeting: each agent reports status, blockers are discussed, tasks are assigned',
    {
      project: z.string().describe('Project or team name for the standup'),
    },
    async (args) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `You are running a standup meeting for "${args.project}" in a Flock room.

Follow this standup workflow:
0. Call flock_update with display_name (e.g. your role) if you haven't set one yet.
1. Call flock_room_list to find or create the standup room
2. Call flock_discover to find team agents
3. Call flock_post to start the standup: "Standup for ${args.project} — please report: (1) what you did, (2) what you'll do, (3) any blockers"
4. Call flock_wait to collect responses
5. Summarize each agent's update in a single message
6. For blockers, create threads and discuss solutions
7. Call flock_post with action items and assignments
8. Use flock_react (agree) on confirmed action items

Keep it concise — each update should be 2-3 sentences max.`,
            },
          },
        ],
      };
    },
  );
}
