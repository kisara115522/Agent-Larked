/**
 * Child-process environment filtering for spawned claude CLI subprocesses.
 *
 * Mirrors multica's isFilteredChildEnvKey: strip internal Claude Code runtime
 * markers (so the child does not mistake itself for a nested/resumed session or
 * inherit the parent's exec path/transport) and strip CLAUDE_EFFORT (so the
 * parent session's effort level never silently enables extended thinking in the
 * child — extended thinking produces signatures the Bedrock proxy rejects on
 * resume). User-facing CLAUDE_CODE_* config (CLAUDE_CODE_USE_BEDROCK,
 * CLAUDE_CODE_MAX_OUTPUT_TOKENS, ...) is deliberately preserved.
 */

/** Internal per-process markers that must NOT leak into the child. */
const INTERNAL_ENV_KEYS = new Set([
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SSE_PORT',
]);

/** Effort marker — stripped to keep extended thinking off in spawned agents. */
const EFFORT_ENV_KEY = 'CLAUDE_EFFORT';

export function isInternalClaudeEnvKey(key: string): boolean {
  if (INTERNAL_ENV_KEYS.has(key)) return true;
  if (key === EFFORT_ENV_KEY) return true;
  // CLAUDECODE_* (no underscore between CLAUDE and CODE) is wholly internal.
  // The user-facing namespace is CLAUDE_CODE_* and is preserved.
  return key.startsWith('CLAUDECODE_');
}
