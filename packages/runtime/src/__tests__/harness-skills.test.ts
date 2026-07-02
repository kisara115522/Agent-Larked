import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentHarness } from '../harness/agent-harness.js';
import { BackendRegistry } from '../harness/backend-registry.js';

describe('AgentHarness skills materialization', () => {
  let cwd: string;
  let harness: AgentHarness;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'flock-skill-test-'));
    // Register a no-op backend so spawn doesn't actually run claude.
    const registry = new BackendRegistry();
    registry.register('claude-stdio', () => ({
      name: 'claude-stdio',
      run: async function* () {
        yield { type: 'result' as const, subtype: 'completed' as const, durationMs: 0, sessionId: 's' };
      },
      abort: () => {},
    }) as never);
    harness = new AgentHarness({
      flockServerUrl: 'http://x',
      cwd,
      mcpServerPath: '/tmp/mcp.js',
      dbPath: '/tmp/db.sqlite',
      backendRegistry: registry,
      reportActivity: async () => {},
    });
  });

  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it('writes SKILL.md with frontmatter', async () => {
    const session = await harness.spawn({
      agentId: 'a1', agentName: 'A', prompt: 'x', cwd,
      skills: [{ name: 'code-review', description: 'Review code', body: 'Do X.' }],
    });
    await session.promise.catch(() => {});
    const p = join(cwd, '.claude', 'skills', 'code-review', 'SKILL.md');
    expect(existsSync(p)).toBe(true);
    const text = readFileSync(p, 'utf8');
    expect(text).toContain('name: code-review');
    expect(text).toContain('description: Review code');
    expect(text).toContain('Do X.');
  });

  it('clears stale skills before writing (multica-style)', async () => {
    const staleDir = join(cwd, '.claude', 'skills', 'stale');
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, 'SKILL.md'), 'STALE');

    const session = await harness.spawn({
      agentId: 'a2', agentName: 'A', prompt: 'x', cwd,
      skills: [{ name: 'fresh', description: '', body: '' }],
    });
    await session.promise.catch(() => {});
    expect(existsSync(join(cwd, '.claude', 'skills', 'stale'))).toBe(false);
    expect(existsSync(join(cwd, '.claude', 'skills', 'fresh'))).toBe(true);
  });

  it('leaves .claude/skills/ untouched when skills is empty', async () => {
    const existingDir = join(cwd, '.claude', 'skills', 'preexisting');
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(join(existingDir, 'SKILL.md'), 'KEEP');

    const session = await harness.spawn({ agentId: 'a3', agentName: 'A', prompt: 'x', cwd });
    await session.promise.catch(() => {});
    expect(readFileSync(join(existingDir, 'SKILL.md'), 'utf8')).toBe('KEEP');
  });

  it('rejects skill names with path traversal chars', async () => {
    const session = await harness.spawn({
      agentId: 'a4', agentName: 'A', prompt: 'x', cwd,
      skills: [{ name: '../evil', description: '', body: '' }],
    });
    await session.promise.catch(() => {});
    expect(existsSync(join(cwd, '.claude', 'skills', '..', 'evil'))).toBe(false);
  });
});
