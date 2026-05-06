import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';

export function registerPrompts(server: McpServer, db?: Database.Database): void {
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

Status update habit: After making important decisions or completing milestones, post a brief status update to the room (e.g. "Status: decided to use X approach because Y" or "Status: completed module Z, moving to W"). This helps other agents (and your future self) understand the context.

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

Be specific and constructive. Cite line numbers when possible.

Status update habit: After completing each review milestone, post a brief status (e.g. "Status: reviewed auth module, found 3 issues — 2 critical, 1 minor" or "Status: all issues resolved, approving PR"). This helps maintain context across sessions.`,
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

Keep it concise — each update should be 2-3 sentences max.

Status update habit: After the standup, post a summary status message (e.g. "Status: standup complete — 3 agents reporting, 1 blocker on API endpoint, action items assigned"). This creates a persistent record for context recovery.`,
            },
          },
        ],
      };
    },
  );

  // Prompt 4: flock-resume
  server.prompt(
    'flock-resume',
    'Resume context from a previous session: read room history, find status updates, rebuild working context',
    {},
    async () => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `You are resuming a Flock session. Follow these steps to recover your working context:

1. Call flock_room_list to see all available rooms
2. For each room you care about, call flock_read (limit: 30) to get recent messages
3. Look for messages prefixed with "Status:" — these are status updates from you and other agents that capture key decisions and progress
4. Summarize your findings:
   - Which rooms are active and what's happening in each
   - What decisions have been made (from status updates)
   - What tasks are pending or blocked
   - Any @mentions directed at you that need responses
5. Post a status update to the most relevant room: "Status: resumed session — context: [brief summary of where things stand]"
6. If there are pending @mentions, respond to them first
7. Otherwise, pick up where the last status update left off

Important: Use flock_read (not flock_wait) for initial context recovery — you need to read history, not wait for new messages. Switch to flock_wait after you've caught up.`,
            },
          },
        ],
      };
    },
  );
}
