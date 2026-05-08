import type Database from 'better-sqlite3';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface QueuedMention {
  mention_id: string;
  message_id: string;
  room_id: string;
  room_name: string;
  sender_id: string;
  sender_name: string;
  sender_display_name: string;
  recipient_id: string;
  created_at: string;
  queued_at: string;
  priority: 'direct';
  dedupe_key: string;
  excerpt: string;
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

function queuePath(): string {
  return join(flockHome(), 'unread.jsonl');
}

function seenPath(): string {
  return join(flockHome(), 'mentions-seen.json');
}

function ensureHome(): void {
  mkdirSync(flockHome(), { recursive: true });
}

function readJsonl(path: string): QueuedMention[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf-8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as QueuedMention);
}

function writeJsonl(path: string, mentions: QueuedMention[]): void {
  ensureHome();
  const tmp = `${path}.tmp`;
  const body = mentions.map((m) => JSON.stringify(m)).join('\n');
  writeFileSync(tmp, body ? `${body}\n` : '', { encoding: 'utf-8', mode: 0o600 });
  renameSync(tmp, path);
}

function readSeen(): Set<string> {
  if (!existsSync(seenPath())) return new Set();
  try {
    const raw = readFileSync(seenPath(), 'utf-8').trim();
    const values = JSON.parse(raw) as string[];
    return new Set(values);
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<string>): void {
  ensureHome();
  writeFileSync(seenPath(), JSON.stringify([...seen], null, 2), { encoding: 'utf-8', mode: 0o600 });
}

function sanitizeExcerpt(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 16) return normalized;
  return `${normalized.slice(0, 16)}...`;
}

export function listMentionQueue(agentId: string): QueuedMention[] {
  return readJsonl(queuePath()).filter((mention) => mention.recipient_id === agentId);
}

export function drainMentionQueue(agentId: string): QueuedMention[] {
  const all = readJsonl(queuePath());
  const drained = all.filter((mention) => mention.recipient_id === agentId);
  const remaining = all.filter((mention) => mention.recipient_id !== agentId);
  writeJsonl(queuePath(), remaining);
  return drained;
}

export function buildUnreadDigest(agentId: string): { count: number; mentions: QueuedMention[]; summary: string } {
  const mentions = listMentionQueue(agentId);
  if (mentions.length === 0) {
    return { count: 0, mentions: [], summary: '' };
  }

  const first = mentions[0];
  const rooms = new Set(mentions.map((mention) => mention.room_id)).size;
  const sender = first.sender_display_name || first.sender_name || first.sender_id;
  const summary = `Flock: ${mentions.length} unread direct mention${mentions.length === 1 ? '' : 's'} in ${rooms} room${rooms === 1 ? '' : 's'}. Highest priority: ${first.room_name} from ${sender}. Call flock_mentions_list for details.`;
  return { count: mentions.length, mentions, summary };
}

interface ToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

function injectDigestIntoResult(result: ToolResult, db: Database.Database, agentId: string): ToolResult {
  if (result.isError) return result;

  pollDirectMentionsOnce(db, agentId);
  const digest = buildUnreadDigest(agentId);
  if (digest.count === 0 || !result.content || result.content.length === 0) return result;

  const first = result.content[0];
  if (first.type !== 'text' || !first.text) return result;

  try {
    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    return {
      ...result,
      content: [
        {
          ...first,
          text: JSON.stringify({
            ...parsed,
            _unread_mentions: digest,
          }),
        },
        ...result.content.slice(1),
      ],
    };
  } catch {
    return {
      ...result,
      content: [
        ...result.content,
        { type: 'text', text: JSON.stringify({ _unread_mentions: digest }) },
      ],
    };
  }
}

export function installUnreadMentionInjection(
  server: McpServer,
  db: Database.Database,
  agentIdProvider: () => string | null,
): void {
  const mutableServer = server as unknown as {
    registerTool?: (name: string, config: unknown, callback: (...args: unknown[]) => Promise<ToolResult> | ToolResult) => unknown;
    tool?: (...args: unknown[]) => unknown;
  };

  if (mutableServer.registerTool) {
    const originalRegisterTool = mutableServer.registerTool.bind(server);
    mutableServer.registerTool = (name: string, config: unknown, callback: (...args: unknown[]) => Promise<ToolResult> | ToolResult): unknown => {
      return originalRegisterTool(name, config, async (...args: unknown[]) => {
        const result = await callback(...args);
        const agentId = agentIdProvider();
        return agentId ? injectDigestIntoResult(result, db, agentId) : result;
      });
    };
  }

  if (mutableServer.tool) {
    const originalTool = mutableServer.tool.bind(server);
    mutableServer.tool = (...args: unknown[]): unknown => {
      const last = args[args.length - 1];
      if (typeof last !== 'function') {
        return originalTool(...args);
      }

      const wrapped = async (...callbackArgs: unknown[]) => {
        const result = await (last as (...innerArgs: unknown[]) => Promise<ToolResult> | ToolResult)(...callbackArgs);
        const agentId = agentIdProvider();
        return agentId ? injectDigestIntoResult(result, db, agentId) : result;
      };

      return originalTool(...args.slice(0, -1), wrapped);
    };
  }
}

export function startMentionListener(
  db: Database.Database,
  agentIdProvider: () => string | null,
  intervalMs = 30_000,
): { stop: () => void } {
  const poll = () => {
    const agentId = agentIdProvider();
    if (!agentId) return;
    pollDirectMentionsOnce(db, agentId);
  };

  const timer = setInterval(poll, intervalMs);
  return {
    stop: () => clearInterval(timer),
  };
}

export function pollDirectMentionsOnce(db: Database.Database, agentId: string): QueuedMention[] {
  const rows = db.prepare(`
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
  `).all(agentId) as MentionRow[];

  const existing = readJsonl(queuePath());
  const existingKeys = new Set(existing.map((mention) => mention.dedupe_key));
  const seen = readSeen();
  const queued: QueuedMention[] = [];

  for (const row of rows) {
    const dedupeKey = `${row.message_id}:${row.recipient_id}`;
    if (existingKeys.has(dedupeKey) || seen.has(dedupeKey)) continue;

    const mention: QueuedMention = {
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
    };
    queued.push(mention);
    existingKeys.add(dedupeKey);
    seen.add(dedupeKey);
  }

  if (queued.length > 0) {
    writeJsonl(queuePath(), [...existing, ...queued]);
    writeSeen(seen);
  }

  return queued;
}
