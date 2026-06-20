/**
 * Write a claude --settings file wiring the PostToolUse inbox hook.
 *
 * The settings JSON tells the claude CLI to run our hook script after
 * every tool call. The hook reads FLOCK_AGENT_ID + DB_PATH from the
 * environment and injects the agent's inbox digest as additionalContext.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface HookSettingsFile {
  path: string;
  cleanup: () => void;
}

/** Write a claude --settings file wiring the PostToolUse inbox hook. */
export function writeHookSettingsToTemp(hookScriptPath: string): HookSettingsFile {
  const settings = {
    hooks: {
      PostToolUse: [
        { matcher: '*', hooks: [{ type: 'command', command: `node ${hookScriptPath}` }] },
      ],
    },
  };
  const dir = mkdtempSync(join(tmpdir(), 'flock-hooks-'));
  const path = join(dir, 'settings.json');
  writeFileSync(path, JSON.stringify(settings), { mode: 0o600 });
  return {
    path,
    cleanup: () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}
