import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase } from '@flock/server/db';
import { registerAgent } from '@flock/server/services/identity';
import { createRoom, joinRoom } from '@flock/server/services/room';
import { sendMessage } from '@flock/server/services/messaging';
import {
  buildDoctorStatus,
  buildClaudeCodeHookSettings,
  formatSettingsDiff,
  hookCommand,
  removeClaudeCodeHookSettings,
  summarizeUnreadMentions,
  setClaudeCodeWaitOnStop,
  type QueuedMentionDigest,
  writeQueuedMentions,
  writeSeenMentions,
} from './setup.js';

const originalFlockHome = process.env.FLOCK_HOME;
const originalDbPath = process.env.DB_PATH;

afterEach(() => {
  if (originalFlockHome === undefined) {
    delete process.env.FLOCK_HOME;
  } else {
    process.env.FLOCK_HOME = originalFlockHome;
  }

  if (originalDbPath === undefined) {
    delete process.env.DB_PATH;
  } else {
    process.env.DB_PATH = originalDbPath;
  }

  vi.restoreAllMocks();
});

describe('Claude Code hook settings', () => {
  it('adds PostToolUse and Stop hooks without deleting existing settings', () => {
    const settings = buildClaudeCodeHookSettings(
      {
        mcpServers: { flock: { command: 'node' } },
        hooks: {
          PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo existing' }] }],
        },
      },
      'flock hook claude-code',
    );

    expect(settings.mcpServers).toEqual({ flock: { command: 'node' } });
    expect(settings.hooks?.PostToolUse).toHaveLength(2);
    expect(settings.hooks?.PostToolUse?.[1]).toEqual({
      matcher: '*',
      hooks: [{ type: 'command', command: 'flock hook claude-code post-tool-use' }],
    });
    expect(settings.hooks?.Stop).toEqual([
      { hooks: [{ type: 'command', command: 'flock hook claude-code stop' }] },
    ]);
  });

  it('does not duplicate hooks when setup runs twice', () => {
    const once = buildClaudeCodeHookSettings({}, 'flock hook claude-code');
    const twice = buildClaudeCodeHookSettings(once, 'flock hook claude-code');

    expect(twice.hooks?.PostToolUse).toHaveLength(1);
    expect(twice.hooks?.Stop).toHaveLength(1);
  });

  it('removes only Flock hooks', () => {
    const settings = buildClaudeCodeHookSettings(
      {
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'echo keep-me' }] }],
        },
      },
      'flock hook claude-code',
    );

    const removed = removeClaudeCodeHookSettings(settings, 'flock hook claude-code');

    expect(removed.hooks?.Stop).toEqual([
      { hooks: [{ type: 'command', command: 'echo keep-me' }] },
    ]);
    expect(removed.hooks?.PostToolUse).toEqual([]);
  });

  it('can install wait-on-stop mode without changing the default setup', () => {
    const normal = buildClaudeCodeHookSettings({}, 'flock hook claude-code');
    expect(normal.hooks?.Stop).toEqual([
      { hooks: [{ type: 'command', command: 'flock hook claude-code stop' }] },
    ]);

    const waitOnStop = setClaudeCodeWaitOnStop(normal, true, 'flock hook claude-code');
    expect(waitOnStop.hooks?.PostToolUse).toEqual([
      { matcher: '*', hooks: [{ type: 'command', command: 'flock hook claude-code post-tool-use' }] },
    ]);
    expect(waitOnStop.hooks?.Stop).toEqual([
      { hooks: [{ type: 'command', command: 'flock hook claude-code wait-on-stop' }] },
    ]);

    const disabled = setClaudeCodeWaitOnStop(waitOnStop, false, 'flock hook claude-code');
    expect(disabled.hooks?.PostToolUse).toEqual([
      { matcher: '*', hooks: [{ type: 'command', command: 'flock hook claude-code post-tool-use' }] },
    ]);
    expect(disabled.hooks?.Stop).toEqual([
      { hooks: [{ type: 'command', command: 'flock hook claude-code stop' }] },
    ]);
  });

  it('formats a visible settings diff before writing hook settings', () => {
    const current = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo keep-me' }] }] } };
    const next = buildClaudeCodeHookSettings(current, 'flock hook claude-code');

    const diff = formatSettingsDiff(current, next);

    expect(diff).toContain('--- current settings');
    expect(diff).toContain('+++ target settings');
    expect(diff).toContain('-             "command": "echo keep-me"');
    expect(diff).toContain('+         "matcher": "*"');
    expect(diff).toContain('+             "command": "flock hook claude-code post-tool-use"');
  });
});

describe('hook digest', () => {
  it('summarizes queued direct mentions without full content', () => {
    const mentions: QueuedMentionDigest[] = [
      {
        room_name: 'research',
        sender_name: 'Claude-Reviewer',
        sender_display_name: 'gui-2',
        excerpt: 'please review...',
      },
    ];

    const summary = summarizeUnreadMentions(mentions);

    expect(summary).toContain('Flock: 1 unread direct mention');
    expect(summary).toContain('research');
    expect(summary).toContain('gui-2');
    expect(summary).toContain('flock_mentions_list');
    expect(summary).not.toContain('please review');
  });

  it('polls direct mentions from the database at the Claude Code tool boundary', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'flock-cli-hook-mention-'));
    const dbPath = join(tempDir, 'agentfeed.db');
    const db = createDatabase(dbPath);
    try {
      const recipient = registerAgent(db, { name: 'codex-v034-direct' });
      const sender = registerAgent(db, { name: 'gui-1' });
      const room = createRoom(db, sender.id, { name: 'v0.3.5' });
      joinRoom(db, room.id, recipient.id);
      sendMessage(db, sender.id, {
        room_id: room.id,
        content: 'please switch task now',
        mentions: [recipient.id],
        idempotency_key: 'hook-boundary-mention',
      });

      writeFileSync(
        join(tempDir, 'identity.json'),
        JSON.stringify({ id: recipient.id, name: recipient.name }),
        'utf-8',
      );
      process.env.FLOCK_HOME = tempDir;
      process.env.DB_PATH = dbPath;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
        throw new Error(`exit:${code}`);
      });

      await expect(
        hookCommand().parseAsync(['node', 'test', 'claude-code', 'post-tool-use']),
      ).rejects.toThrow('exit:2');

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Flock: 1 unread direct mention'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('v0.3.5'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('flock_mentions_list'));
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('please switch task now'));
    } finally {
      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('does not crash the Claude Code hook when queue files cannot be written', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'flock-cli-hook-io-'));
    const dbPath = join(tempDir, 'agentfeed.db');
    const db = createDatabase(dbPath);
    try {
      const recipient = registerAgent(db, { name: 'codex-v034-direct' });
      const sender = registerAgent(db, { name: 'gui-1' });
      const room = createRoom(db, sender.id, { name: 'v0.3.5' });
      joinRoom(db, room.id, recipient.id);
      sendMessage(db, sender.id, {
        room_id: room.id,
        content: 'queued while disk is unavailable',
        mentions: [recipient.id],
        idempotency_key: 'hook-boundary-mention-io',
      });

      writeFileSync(
        join(tempDir, 'identity.json'),
        JSON.stringify({ id: recipient.id, name: recipient.name }),
        'utf-8',
      );
      mkdirSync(join(tempDir, 'unread.jsonl'));
      process.env.FLOCK_HOME = tempDir;
      process.env.DB_PATH = dbPath;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
        throw new Error(`exit:${code}`);
      });

      await expect(
        hookCommand().parseAsync(['node', 'test', 'claude-code', 'post-tool-use']),
      ).resolves.toBeDefined();

      expect(errorSpy).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('writes queued mentions and seen keys atomically', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'flock-cli-atomic-'));
    try {
      const queuePath = join(tempDir, 'unread.jsonl');
      const seenPath = join(tempDir, 'mentions-seen.json');

      writeQueuedMentions(queuePath, [
        { recipient_id: 'agent-1', room_name: 'v0.3.5', sender_name: 'gui-1' },
      ]);
      writeSeenMentions(seenPath, new Set(['message-1:agent-1']));

      expect(readFileSync(queuePath, 'utf-8')).toContain('"recipient_id":"agent-1"');
      expect(JSON.parse(readFileSync(seenPath, 'utf-8'))).toEqual(['message-1:agent-1']);
      expect(existsSync(`${queuePath}.tmp`)).toBe(false);
      expect(existsSync(`${seenPath}.tmp`)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('doctor status', () => {
  it('reports Claude Code hooks, queue, and listener heartbeat state', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'flock-cli-doctor-'));
    try {
      writeFileSync(join(tempDir, 'unread.jsonl'), '', 'utf-8');
      writeFileSync(
        join(tempDir, 'mentions-listener.json'),
        JSON.stringify({ agent_id: 'agent-1', status: 'running', checked_at: '2026-05-08T00:00:00.000Z' }),
        'utf-8',
      );
      const settings = buildClaudeCodeHookSettings({}, 'flock hook claude-code');

      const status = buildDoctorStatus(settings, '/tmp/settings.json', 'flock hook claude-code', tempDir);

      expect(status.post_tool_use_hook).toBe(true);
      expect(status.stop_hook).toBe(true);
      expect(status.unread_queue_exists).toBe(true);
      expect(status.mention_listener_status_exists).toBe(true);
      expect(status.mention_listener_status).toEqual({
        agent_id: 'agent-1',
        status: 'running',
        checked_at: '2026-05-08T00:00:00.000Z',
      });
      expect(status.current_identity).toBeNull();
      expect(status.unread_count).toBe(0);
      expect(status.unread_for_current_identity).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('reports current identity and unread mention count for that identity', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'flock-cli-doctor-identity-'));
    try {
      writeFileSync(
        join(tempDir, 'identity.json'),
        JSON.stringify({ id: 'agent-1', name: 'codex-v034-direct' }),
        'utf-8',
      );
      writeFileSync(
        join(tempDir, 'unread.jsonl'),
        [
          JSON.stringify({ recipient_id: 'agent-1', room_name: 'v0.3.5', sender_name: 'gui-1' }),
          JSON.stringify({ recipient_id: 'other-agent', room_name: 'v0.3.5', sender_name: 'gui-2' }),
          '{bad json}',
        ].join('\n'),
        'utf-8',
      );

      const status = buildDoctorStatus({}, '/tmp/settings.json', 'flock hook claude-code', tempDir);

      expect(status.identity_file).toBe(join(tempDir, 'identity.json'));
      expect(status.identity_exists).toBe(true);
      expect(status.current_identity).toEqual({ id: 'agent-1', name: 'codex-v034-direct' });
      expect(status.unread_count).toBe(1);
      expect(status.unread_for_current_identity).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
