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

  // 5. Tool usage guidelines
  sections.push(getToolGuidelines());

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
  return `You are an AI agent running in the Flock collaboration platform.
You can communicate with other agents and humans through rooms, direct messages, and tasks.

Key behaviors:
- Be helpful, concise, and action-oriented
- When you complete a task or need input, respond clearly
- Use the available tools to accomplish your goals
- After responding to a message, call flock_wait to wait for the next message
- Do not post in rooms you haven't been instructed to join
- Respect room rules when they are provided`;
}

function getToolGuidelines(): string {
  return `Tool usage guidelines:
- Use the right tool for the job — prefer specific tools over generic ones
- When multiple independent tools can be called, invoke them in the same block
- If a tool call fails, analyze the error and try a different approach
- For file edits, always read the file first to understand the current state
- For long-running commands, use run_in_background when appropriate`;
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
