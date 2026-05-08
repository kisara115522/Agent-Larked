import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

interface HookCommand {
  type: string;
  command: string;
}

interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
  [key: string]: unknown;
}

export interface ClaudeCodeSettings {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

export interface QueuedMentionDigest {
  room_name: string;
  sender_name: string;
  sender_display_name?: string;
  excerpt?: string;
  recipient_id?: string;
}

export interface DoctorStatus {
  claude_code_settings: string;
  post_tool_use_hook: boolean;
  stop_hook: boolean;
  unread_queue: string;
  unread_queue_exists: boolean;
  mention_listener_status_file: string;
  mention_listener_status_exists: boolean;
  mention_listener_status: unknown | null;
}

function flockHome(): string {
  return process.env.FLOCK_HOME || join(homedir(), '.flock');
}

function defaultClaudeSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

function hookCommands(commandPrefix: string): { postToolUse: string; stop: string } {
  return {
    postToolUse: `${commandPrefix} post-tool-use`,
    stop: `${commandPrefix} stop`,
  };
}

function hasHook(entries: HookEntry[], command: string): boolean {
  return entries.some((entry) => entry.hooks.some((hook) => hook.type === 'command' && hook.command === command));
}

export function buildClaudeCodeHookSettings(
  settings: ClaudeCodeSettings,
  commandPrefix = 'flock hook claude-code',
): ClaudeCodeSettings {
  const commands = hookCommands(commandPrefix);
  const hooks: Record<string, HookEntry[]> = { ...(settings.hooks ?? {}) };
  const postToolUse = [...(hooks.PostToolUse ?? [])];
  const stop = [...(hooks.Stop ?? [])];

  if (!hasHook(postToolUse, commands.postToolUse)) {
    postToolUse.push({
      matcher: '*',
      hooks: [{ type: 'command', command: commands.postToolUse }],
    });
  }

  if (!hasHook(stop, commands.stop)) {
    stop.push({
      hooks: [{ type: 'command', command: commands.stop }],
    });
  }

  return {
    ...settings,
    hooks: {
      ...hooks,
      PostToolUse: postToolUse,
      Stop: stop,
    },
  };
}

export function removeClaudeCodeHookSettings(
  settings: ClaudeCodeSettings,
  commandPrefix = 'flock hook claude-code',
): ClaudeCodeSettings {
  const commands = new Set(Object.values(hookCommands(commandPrefix)));
  const hooks: Record<string, HookEntry[]> = {};

  for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
    hooks[event] = entries
      .map((entry) => ({
        ...entry,
        hooks: entry.hooks.filter((hook) => !commands.has(hook.command)),
      }))
      .filter((entry) => entry.hooks.length > 0);
  }

  return { ...settings, hooks };
}

export function formatSettingsDiff(current: ClaudeCodeSettings, target: ClaudeCodeSettings): string {
  const currentLines = JSON.stringify(current, null, 2).split('\n');
  const targetLines = JSON.stringify(target, null, 2).split('\n');

  return [
    '--- current settings',
    '+++ target settings',
    ...currentLines.map((line) => `- ${line}`),
    ...targetLines.map((line) => `+ ${line}`),
  ].join('\n');
}

export function summarizeUnreadMentions(mentions: QueuedMentionDigest[]): string {
  if (mentions.length === 0) return '';
  const first = mentions[0];
  const sender = first.sender_display_name || first.sender_name;
  const room = first.room_name || 'unknown room';
  return `Flock: ${mentions.length} unread direct mention${mentions.length === 1 ? '' : 's'}. Highest priority: ${room} from ${sender}. Call flock_mentions_list for details.`;
}

function readSettings(path: string): ClaudeCodeSettings {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf-8')) as ClaudeCodeSettings;
}

function readJsonFile(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  } catch {
    return null;
  }
}

function writeSettings(path: string, settings: ClaudeCodeSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    writeFileSync(`${path}.bak-${Date.now()}`, readFileSync(path));
  }
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
}

function readQueuedMentions(): QueuedMentionDigest[] {
  const identityPath = join(flockHome(), 'identity.json');
  const queuePath = join(flockHome(), 'unread.jsonl');
  if (!existsSync(identityPath) || !existsSync(queuePath)) return [];

  let identity: { id?: string };
  try {
    identity = JSON.parse(readFileSync(identityPath, 'utf-8')) as { id?: string };
    if (!identity.id) return [];
  } catch {
    return [];
  }

  const raw = readFileSync(queuePath, 'utf-8').trim();
  if (!raw) return [];

  const mentions: QueuedMentionDigest[] = [];
  for (const line of raw.split('\n').filter(Boolean)) {
    try {
      const mention = JSON.parse(line) as QueuedMentionDigest;
      if (mention.recipient_id === identity.id) mentions.push(mention);
    } catch {
      // Ignore malformed queue entries; the hook must never block normal tool use.
    }
  }
  return mentions;
}

export function buildDoctorStatus(
  settings: ClaudeCodeSettings,
  settingsPath: string,
  commandPrefix: string,
  home = flockHome(),
): DoctorStatus {
  const commands = hookCommands(commandPrefix);
  const queuePath = join(home, 'unread.jsonl');
  const listenerStatusPath = join(home, 'mentions-listener.json');

  return {
    claude_code_settings: settingsPath,
    post_tool_use_hook: hasHook(settings.hooks?.PostToolUse ?? [], commands.postToolUse),
    stop_hook: hasHook(settings.hooks?.Stop ?? [], commands.stop),
    unread_queue: queuePath,
    unread_queue_exists: existsSync(queuePath),
    mention_listener_status_file: listenerStatusPath,
    mention_listener_status_exists: existsSync(listenerStatusPath),
    mention_listener_status: readJsonFile(listenerStatusPath),
  };
}

export function setupCommand(): Command {
  const setup = new Command('setup').description('Configure Flock integrations');

  setup
    .command('claude-code')
    .description('Install Claude Code boundary notification hooks')
    .option('--settings <path>', 'Claude Code settings path', defaultClaudeSettingsPath())
    .option('--command <command>', 'Hook command prefix', 'flock hook claude-code')
    .option('--yes', 'Write settings after printing the target configuration')
    .action((opts: { settings: string; command: string; yes?: boolean }) => {
      const current = readSettings(opts.settings);
      const next = buildClaudeCodeHookSettings(current, opts.command);
      console.log(formatSettingsDiff(current, next));
      if (!opts.yes) {
        console.log(`\nDry run only. Re-run with --yes to update ${opts.settings}.`);
        return;
      }
      writeSettings(opts.settings, next);
      console.log(`Updated ${opts.settings}`);
    });

  return setup;
}

export function uninstallCommand(): Command {
  const uninstall = new Command('uninstall').description('Remove Flock integrations');

  uninstall
    .command('claude-code')
    .description('Remove Claude Code boundary notification hooks')
    .option('--settings <path>', 'Claude Code settings path', defaultClaudeSettingsPath())
    .option('--command <command>', 'Hook command prefix', 'flock hook claude-code')
    .option('--yes', 'Write settings after printing the target configuration')
    .action((opts: { settings: string; command: string; yes?: boolean }) => {
      const current = readSettings(opts.settings);
      const next = removeClaudeCodeHookSettings(current, opts.command);
      console.log(formatSettingsDiff(current, next));
      if (!opts.yes) {
        console.log(`\nDry run only. Re-run with --yes to update ${opts.settings}.`);
        return;
      }
      writeSettings(opts.settings, next);
      console.log(`Updated ${opts.settings}`);
    });

  return uninstall;
}

export function hookCommand(): Command {
  const hook = new Command('hook').description('Internal Flock hook adapters');

  hook
    .command('claude-code <event>')
    .description('Claude Code hook adapter. Exits 2 when unread direct mentions should be surfaced.')
    .action((event: string) => {
      if (event !== 'post-tool-use' && event !== 'stop') return;
      const summary = summarizeUnreadMentions(readQueuedMentions());
      if (!summary) return;
      console.error(summary);
      process.exit(2);
    });

  return hook;
}

export function doctorCommand(): Command {
  return new Command('doctor')
    .description('Check Flock local integration status')
    .option('--settings <path>', 'Claude Code settings path', defaultClaudeSettingsPath())
    .option('--command <command>', 'Hook command prefix', 'flock hook claude-code')
    .action((opts: { settings: string; command: string }) => {
      const settings = readSettings(opts.settings);
      console.log(JSON.stringify(buildDoctorStatus(settings, opts.settings, opts.command), null, 2));
    });
}
