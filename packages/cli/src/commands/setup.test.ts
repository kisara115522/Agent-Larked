import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildDoctorStatus,
  buildClaudeCodeHookSettings,
  formatSettingsDiff,
  removeClaudeCodeHookSettings,
  summarizeUnreadMentions,
  setClaudeCodeWaitOnStop,
  type QueuedMentionDigest,
} from './setup.js';

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
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
