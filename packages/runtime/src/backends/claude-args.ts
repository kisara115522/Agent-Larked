/**
 * Build the claude CLI argv for a stdio-driven agent session.
 *
 * Hardcodes the protocol-critical flags (stream-json in/out, verbose, strict
 * mcp config, bypassPermissions, AskUserQuestion disabled, effort=low).
 * Effort/thinking beyond normal is intentionally NOT enabled — see migration plan §1.2.
 */
import type { AgentRunContext } from './types.js';

export interface ClaudeArgsExtra {
  mcpConfigPath: string;
  resumeSessionId?: string;
  hookSettingsPath?: string;
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
    // Override effortLevel from settings.json without blocking the whole file.
    // --setting-sources "" also strips auth tokens injected via settings.json env,
    // so we use --effort instead. 'normal' is NOT a valid CLI value (valid:
    // low/medium/high/xhigh/max). 'low' disables extended thinking and matches
    // the stdio migration's default-off intent (see migration plan §1.2).
    '--effort', 'low',
  ];

  if (ctx.model) args.push('--model', ctx.model);
  if (ctx.maxTurns != null) args.push('--max-turns', String(ctx.maxTurns));
  if (ctx.maxBudgetUsd != null) args.push('--max-budget-usd', String(ctx.maxBudgetUsd));
  if (ctx.systemPrompt) args.push('--append-system-prompt', ctx.systemPrompt);
  if (extra.resumeSessionId) args.push('--resume', extra.resumeSessionId);
  if (extra.hookSettingsPath) args.push('--settings', extra.hookSettingsPath);

  return args;
}
