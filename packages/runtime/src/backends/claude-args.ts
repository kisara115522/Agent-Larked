/**
 * Build the claude CLI argv for a stdio-driven agent session.
 *
 * Hardcodes the protocol-critical flags (stream-json in/out, verbose, strict
 * mcp config, bypassPermissions, AskUserQuestion disabled, settings sources
 * cleared). Effort/thinking is intentionally NOT passed — see migration plan §1.2.
 */
import type { AgentRunContext } from './types.js';

export interface ClaudeArgsExtra {
  mcpConfigPath: string;
  resumeSessionId?: string;
}

export function buildClaudeArgs(ctx: AgentRunContext, extra: ClaudeArgsExtra): string[] {
  const args: string[] = [
    '-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
    '--strict-mcp-config',
    '--mcp-config', extra.mcpConfigPath,
    '--permission-mode', 'bypassPermissions',
    // AskUserQuestion has no UI in non-interactive mode; calling it strands the
    // agent. Steer clarifications to room messages instead (mirrors multica).
    '--disallowedTools', 'AskUserQuestion',
    // Block ~/.claude/settings.json (effortLevel:high etc.) from loading.
    '--setting-sources', '',
  ];

  if (ctx.model) args.push('--model', ctx.model);
  if (ctx.maxTurns != null) args.push('--max-turns', String(ctx.maxTurns));
  if (ctx.maxBudgetUsd != null) args.push('--max-budget-usd', String(ctx.maxBudgetUsd));
  if (ctx.systemPrompt) args.push('--append-system-prompt', ctx.systemPrompt);
  if (extra.resumeSessionId) args.push('--resume', extra.resumeSessionId);

  return args;
}
