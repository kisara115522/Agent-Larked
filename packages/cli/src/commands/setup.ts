import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createDatabase } from '@flock/server/db';

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
  mention_id?: string;
  message_id?: string;
  room_id?: string;
  room_name: string;
  sender_id?: string;
  sender_name: string;
  sender_display_name?: string;
  excerpt?: string;
  recipient_id?: string;
  created_at?: string;
  queued_at?: string;
  priority?: 'direct';
  dedupe_key?: string;
}

export interface DoctorStatus {
  claude_code_settings: string;
  post_tool_use_hook: boolean;
  stop_hook: boolean;
  hooks_ready: boolean;
  identity_file: string;
  identity_exists: boolean;
  current_identity: { id: string; name: string } | null;
  unread_queue: string;
  unread_queue_exists: boolean;
  unread_count: number;
  unread_for_current_identity: boolean;
  unread_total: number;
  unread_recipient_ids: string[];
  listener_identity_matches_current: boolean | null;
  mention_listener_status_file: string;
  mention_listener_status_exists: boolean;
  mention_listener_status: unknown | null;
  warnings: string[];
}

interface MentionRow {
  message_id: string;
  room_id: string;
  room_name: string;
  sender_id: string;
  sender_name: string;
  sender_display_name: string | null;
  recipient_id: string;
  content: string;
  created_at: string;
}

function flockHome(): string {
  return process.env.FLOCK_HOME || join(homedir(), '.flock');
}

function agentDir(): string {
  const agentName = process.env.AGENT_NAME;
  if (agentName) {
    return join(flockHome(), 'agents', agentName);
  }
  return flockHome();
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

function waitOnStopCommand(commandPrefix: string): string {
  return `${commandPrefix} wait-on-stop`;
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

export function setClaudeCodeWaitOnStop(
  settings: ClaudeCodeSettings,
  enabled: boolean,
  commandPrefix = 'flock hook claude-code',
): ClaudeCodeSettings {
  const commands = hookCommands(commandPrefix);
  const stopCommand = enabled ? waitOnStopCommand(commandPrefix) : commands.stop;
  const removed = removeSpecificHook(removeSpecificHook(settings, commands.stop), waitOnStopCommand(commandPrefix));
  return {
    ...removed,
    hooks: {
      ...(removed.hooks ?? {}),
      Stop: [{ hooks: [{ type: 'command', command: stopCommand }] }],
    },
  };
}

function removeSpecificHook(settings: ClaudeCodeSettings, command: string): ClaudeCodeSettings {
  const hooks: Record<string, HookEntry[]> = {};
  for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
    hooks[event] = entries
      .map((entry) => ({
        ...entry,
        hooks: entry.hooks.filter((hook) => hook.command !== command),
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

function readQueue(path: string): QueuedMentionDigest[] {
  let raw: string;
  try {
    if (!existsSync(path)) return [];
    raw = readFileSync(path, 'utf-8').trim();
    if (!raw) return [];
  } catch {
    return [];
  }

  const queue: QueuedMentionDigest[] = [];
  for (const line of raw.split('\n').filter(Boolean)) {
    try {
      queue.push(JSON.parse(line) as QueuedMentionDigest);
    } catch {
      // Ignore malformed queue entries; the hook must never block normal tool use.
    }
  }
  return queue;
}

function writeJsonAtomic(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, { encoding: 'utf-8', mode: 0o600 });
  renameSync(tmp, path);
}

export function writeQueuedMentions(path: string, mentions: QueuedMentionDigest[]): void {
  const body = mentions.map((mention) => JSON.stringify(mention)).join('\n');
  writeJsonAtomic(path, body ? `${body}\n` : '');
}

function readSeen(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  try {
    const raw = readFileSync(path, 'utf-8').trim();
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function writeSeenMentions(path: string, seen: Set<string>): void {
  writeJsonAtomic(path, `${JSON.stringify([...seen], null, 2)}\n`);
}

function sanitizeExcerpt(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 16) return normalized;
  return `${normalized.slice(0, 16)}...`;
}

function readQueuedMentions(home = agentDir()): QueuedMentionDigest[] {
  const identity = readIdentity(home);
  const queuePath = join(home, 'unread.jsonl');
  if (!identity || !existsSync(queuePath)) return [];
  return readQueue(queuePath).filter((mention) => mention.recipient_id === identity.id);
}

function pollDirectMentionsAtBoundary(home = agentDir()): void {
  const identity = readIdentity(home);
  if (!identity) return;

  let db: ReturnType<typeof createDatabase> | null = null;
  let rows: MentionRow[];
  try {
    db = createDatabase(getDbPath());
    rows = db.prepare(`
      SELECT
        mm.message_id,
        mm.agent_id AS recipient_id,
        m.room_id,
        r.name AS room_name,
        m.from_agent AS sender_id,
        p.name AS sender_name,
        p.display_name AS sender_display_name,
        m.content,
        m.created_at
      FROM message_mentions mm
      INNER JOIN messages m ON m.id = mm.message_id
      INNER JOIN rooms r ON r.id = m.room_id
      INNER JOIN profiles p ON p.id = m.from_agent
      INNER JOIN room_members rm ON rm.room_id = m.room_id AND rm.agent_id = mm.agent_id
      WHERE mm.agent_id = ?
      ORDER BY m.created_order ASC
    `).all(identity.id) as MentionRow[];
  } catch {
    return;
  } finally {
    db?.close();
  }

  const queuePath = join(home, 'unread.jsonl');
  const seenPath = join(home, 'mentions-seen.json');
  let existing: QueuedMentionDigest[];
  let seen: Set<string>;
  try {
    existing = readQueue(queuePath);
    seen = readSeen(seenPath);
  } catch {
    return;
  }
  const existingKeys = new Set(existing.map((mention) => mention.dedupe_key).filter(Boolean));
  const queued: QueuedMentionDigest[] = [];

  for (const row of rows) {
    const dedupeKey = `${row.message_id}:${row.recipient_id}`;
    if (existingKeys.has(dedupeKey) || seen.has(dedupeKey)) continue;
    queued.push({
      mention_id: dedupeKey,
      message_id: row.message_id,
      room_id: row.room_id,
      room_name: row.room_name,
      sender_id: row.sender_id,
      sender_name: row.sender_name,
      sender_display_name: row.sender_display_name ?? '',
      recipient_id: row.recipient_id,
      created_at: row.created_at,
      queued_at: new Date().toISOString(),
      priority: 'direct',
      dedupe_key: dedupeKey,
      excerpt: sanitizeExcerpt(row.content),
    });
    existingKeys.add(dedupeKey);
    seen.add(dedupeKey);
  }

  if (queued.length === 0) return;
  try {
    writeQueuedMentions(queuePath, [...existing, ...queued]);
    writeSeenMentions(seenPath, seen);
  } catch {
    // Hook adapters must not crash or block the host if local queue files cannot be updated.
  }
}

export function buildDoctorStatus(
  settings: ClaudeCodeSettings,
  settingsPath: string,
  commandPrefix: string,
  home = agentDir(),
): DoctorStatus {
  const commands = hookCommands(commandPrefix);
  const identityPath = join(home, 'identity.json');
  const queuePath = join(home, 'unread.jsonl');
  const listenerStatusPath = join(home, 'mentions-listener.json');
  const identity = readIdentity(home);
  const allQueuedMentions = readQueue(queuePath);
  const unreadMentions = identity ? allQueuedMentions.filter((mention) => mention.recipient_id === identity.id) : [];
  const postToolUseHook = hasHook(settings.hooks?.PostToolUse ?? [], commands.postToolUse);
  const stopHook = hasHook(settings.hooks?.Stop ?? [], commands.stop);
  const listenerStatus = readJsonFile(listenerStatusPath);
  const listenerAgentId = typeof listenerStatus === 'object' && listenerStatus !== null && 'agent_id' in listenerStatus
    ? (listenerStatus as { agent_id?: unknown }).agent_id
    : undefined;
  const listenerIdentityMatchesCurrent = identity && typeof listenerAgentId === 'string'
    ? listenerAgentId === identity.id
    : null;
  const unreadRecipientIds = [...new Set(allQueuedMentions.map((mention) => mention.recipient_id).filter((id): id is string => Boolean(id)))];
  const warnings: string[] = [];
  if (!postToolUseHook || !stopHook) {
    warnings.push('Claude Code Flock hooks are not fully installed; run `flock setup claude-code --yes` for non-Flock tool boundary delivery.');
  }
  if (listenerIdentityMatchesCurrent === false) {
    warnings.push('Mention listener identity does not match current identity; this session may be reading a stale or shared identity file.');
  }
  if (identity && unreadMentions.length === 0 && unreadRecipientIds.length > 0) {
    warnings.push('Unread mention queue has entries for other agent identities; current identity may not match this running agent.');
  }

  return {
    claude_code_settings: settingsPath,
    post_tool_use_hook: postToolUseHook,
    stop_hook: stopHook,
    hooks_ready: postToolUseHook && stopHook,
    identity_file: identityPath,
    identity_exists: existsSync(identityPath),
    current_identity: identity,
    unread_queue: queuePath,
    unread_queue_exists: existsSync(queuePath),
    unread_count: unreadMentions.length,
    unread_for_current_identity: unreadMentions.length > 0,
    unread_total: allQueuedMentions.length,
    unread_recipient_ids: unreadRecipientIds,
    listener_identity_matches_current: listenerIdentityMatchesCurrent,
    mention_listener_status_file: listenerStatusPath,
    mention_listener_status_exists: existsSync(listenerStatusPath),
    mention_listener_status: listenerStatus,
    warnings,
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

  setup
    .command('claude-code-wait-on-stop')
    .description('Install Claude Code Stop hook wait-on-stop mode')
    .option('--settings <path>', 'Claude Code settings path', defaultClaudeSettingsPath())
    .option('--command <command>', 'Hook command prefix', 'flock hook claude-code')
    .option('--yes', 'Write settings after printing the target configuration')
    .action((opts: { settings: string; command: string; yes?: boolean }) => {
      const current = readSettings(opts.settings);
      const next = setClaudeCodeWaitOnStop(buildClaudeCodeHookSettings(current, opts.command), true, opts.command);
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

function getDbPath(): string {
  if (process.env.DB_PATH) return resolve(process.env.DB_PATH);
  // Prefer project-relative ./data/agentfeed.db (matches server/MCP default)
  const projectDb = resolve('./data/agentfeed.db');
  if (existsSync(projectDb)) return projectDb;
  return resolve(join(homedir(), '.flock', 'agentfeed.db'));
}

function readIdentity(home?: string): { id: string; name: string } | null {
  // If explicit home, use it directly
  if (home) {
    try {
      const raw = readFileSync(join(home, 'identity.json'), 'utf-8').trim();
      const identity = JSON.parse(raw) as { id?: string; name?: string };
      if (identity.id && identity.name) return { id: identity.id, name: identity.name };
    } catch { /* ignore */ }
    return null;
  }
  // Auto-detect: check per-agent directory first, then global
  const agentDirPath = agentDir();
  const globalDir = flockHome();
  for (const dir of [agentDirPath, ...(agentDirPath !== globalDir ? [globalDir] : [])]) {
    try {
      const raw = readFileSync(join(dir, 'identity.json'), 'utf-8').trim();
      const identity = JSON.parse(raw) as { id?: string; name?: string };
      if (identity.id && identity.name) return { id: identity.id, name: identity.name };
    } catch { /* ignore */ }
  }
  return null;
}

function setAgentStatusViaDb(status: 'online' | 'offline'): void {
  const identity = readIdentity();
  if (!identity) return;
  try {
    const db = createDatabase(getDbPath());
    const now = new Date().toISOString();
    if (status === 'online') {
      db.prepare('UPDATE profiles SET status = ?, updated_at = ?, last_active_at = ? WHERE id = ?').run(status, now, now, identity.id);
    } else {
      db.prepare('UPDATE profiles SET status = ?, updated_at = ? WHERE id = ?').run(status, now, identity.id);
    }
    db.close();
  } catch { /* DB may not exist yet; hook must not crash the host */ }
}

export function hookCommand(): Command {
  const hook = new Command('hook').description('Internal Flock hook adapters');

  hook
    .command('claude-code <event>')
    .description('Claude Code hook adapter. Sets agent online/offline via turn lifecycle and checks unread mentions.')
    .action((event: string) => {
      if (event !== 'post-tool-use' && event !== 'stop' && event !== 'wait-on-stop') return;

      // wait-on-stop: prompt agent to call flock_wait instead of stopping
      if (event === 'wait-on-stop') {
        console.error('Flock wait-on-stop mode is enabled. Do not stop this agent turn; call flock_wait instead and continue waiting for collaboration messages.');
        process.exit(2);
      }

      // Turn lifecycle: PostToolUse → online, Stop → offline
      if (event === 'post-tool-use') {
        setAgentStatusViaDb('online');
      } else if (event === 'stop') {
        setAgentStatusViaDb('offline');
      }

      // Check unread mentions. This DB poll is the foreground fallback when the
      // background listener has not run before the next host boundary.
      pollDirectMentionsAtBoundary();
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
