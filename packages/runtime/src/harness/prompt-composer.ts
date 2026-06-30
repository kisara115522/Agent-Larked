/**
 * Prompt Composer — assembles the full system prompt for an agent session.
 *
 * Inspired by Claude Code's prompt architecture (constants/prompts.ts),
 * but simplified for the Flock context:
 *
 *  Static sections (cacheable):
 *    - Base agent instructions
 *    - Tool usage guidelines
 *  Dynamic sections (per-session):
 *    - Agent identity (name, role, capabilities)
 *    - Room context (rules, recent messages, members)
 *    - Environment info (date, cwd, etc.)
 */

export interface PromptParts {
  /** The complete system prompt string */
  systemPrompt: string;
  /** Sections that were composed (for debugging) */
  sections: string[];
}

export interface AgentIdentity {
  agentId: string;
  agentName: string;
  role?: string;
  capabilities?: string[];
}

export interface RoomContext {
  roomId: string;
  roomName: string;
  roomRules?: string;
  recentMessages?: Array<{
    sender: string;
    content: string;
    timestamp: string;
  }>;
  members?: string[];
}

export interface ComposeOptions {
  /** Agent identity information */
  identity: AgentIdentity;
  /** Room context (if the agent is in a room) */
  room?: RoomContext;
  /** Additional user-defined prompt to append */
  appendPrompt?: string;
  /** Custom base prompt to replace the default */
  customBasePrompt?: string;
  /** Current date (defaults to now) */
  date?: string;
  /** Working directory */
  cwd?: string;
}

/**
 * Compose the full system prompt from parts.
 */
export function composeSystemPrompt(options: ComposeOptions): PromptParts {
  const sections: string[] = [];

  // 1. Base instructions (or custom)
  if (options.customBasePrompt) {
    sections.push(options.customBasePrompt);
  } else {
    sections.push(getBaseInstructions());
  }

  // 2. Agent identity
  sections.push(composeIdentitySection(options.identity));

  // 3. Room context
  if (options.room) {
    sections.push(composeRoomSection(options.room));
  }

  // 4. Environment info
  sections.push(composeEnvSection({
    date: options.date ?? new Date().toISOString(),
    cwd: options.cwd ?? process.cwd(),
  }));

  // 5. Inbox + todo handling instructions
  sections.push(getInboxInstructions());

  // 6. User append
  if (options.appendPrompt) {
    sections.push(options.appendPrompt);
  }

  return {
    systemPrompt: sections.join('\n\n'),
    sections,
  };
}

// ─── Static Sections ────────────────────────────────────────────────────────

function getBaseInstructions(): string {
  return `You are an AI agent operating in the Flock collaboration platform — a multi-agent workspace where humans and agents communicate through rooms, direct messages, and tasks.

## Your role
- You are an autonomous worker: given a task, use tools to investigate, decide, and act — then report results clearly and concisely.
- You operate inside a working directory (your workspace). Keep file reads, edits, and shell commands scoped to it unless explicitly told otherwise.

## Collaboration
- After you finish responding to a message, call flock_wait to stay available for the next one. Do not exit.
- Only post in rooms you've been instructed to join. Respect the room rules provided to you.
- When a human or another agent is waiting on you, be responsive: either act, or acknowledge with a brief plan.

## Doing work
- Prefer specific tools over generic ones. When several independent tool calls are possible, invoke them in one block.
- If a tool call fails, read the error and adapt rather than retrying blindly.
- For file edits, read the file first to understand its current state.
- For long-running commands, use run_in_background when appropriate.`;
}

function getInboxInstructions(): string {
  return `Handling incoming messages while you work:
While you are working on a task, new messages may arrive from humans or other agents.
After ANY tool call (including Bash/Read/Edit), they are surfaced to you as a
"FLOCK INBOX" note containing "new_messages" (things people sent you), "open_todos"
(your own pending queue), and "guidance". This is how you stay reachable without
being interrupted — you see it at the next tool boundary, not mid-action.

When you see a FLOCK INBOX with new_messages, for EACH message decide:
- If it is quick, urgent, or blocks someone: handle it now — reply with flock_dm_send
  or flock_post, then return to your work.
- If your current work is more important and the message can wait: call flock_todo_add
  to record it (in your own words), then continue. This guarantees you won't forget it.
- Never silently ignore a message. Either act on it or enqueue it.

Your todo queue (open_todos) is YOURS to manage:
- flock_todo_add — capture something to do later.
- flock_todo_list — review what's pending when you reach a stopping point.
- flock_todo_complete — mark a todo done (or dropped) once handled.
Whenever open_todos is non-empty and you finish your current step, address the
highest-priority todo before going idle. Do not call flock_wait while you still
have open todos you intend to do — clear them first.`;
}

// ─── Dynamic Sections ───────────────────────────────────────────────────────

function composeIdentitySection(identity: AgentIdentity): string {
  const parts = [`Agent Identity: ${identity.agentName} (ID: ${identity.agentId})`];

  if (identity.role) {
    parts.push(`Role: ${identity.role}`);
  }

  if (identity.capabilities && identity.capabilities.length > 0) {
    parts.push(`Capabilities: ${identity.capabilities.join(', ')}`);
  }

  return parts.join('\n');
}

function composeRoomSection(room: RoomContext): string {
  const parts = [
    `Current Room: "${room.roomName}" (${room.roomId})`,
  ];

  if (room.roomRules) {
    parts.push(`Room Rules:\n${room.roomRules}`);
  }

  if (room.members && room.members.length > 0) {
    parts.push(`Room Members: ${room.members.join(', ')}`);
  }

  if (room.recentMessages && room.recentMessages.length > 0) {
    parts.push('Recent Messages:');
    for (const msg of room.recentMessages.slice(-10)) {
      parts.push(`  [${msg.timestamp}] ${msg.sender}: ${msg.content.slice(0, 200)}`);
    }
  }

  return parts.join('\n');
}

function composeEnvSection(env: { date: string; cwd: string }): string {
  return [
    `Environment:`,
    `Date: ${env.date}`,
    `Working Directory: ${env.cwd}`,
  ].join('\n');
}
