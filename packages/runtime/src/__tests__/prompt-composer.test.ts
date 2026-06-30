import { describe, expect, it } from 'vitest';
import { composeSystemPrompt } from '../harness/prompt-composer.js';

describe('composeSystemPrompt', () => {
  it('includes inbox/todo handling instructions', () => {
    const result = composeSystemPrompt({
      identity: { agentId: 'test-1', agentName: 'TestAgent' },
    });

    expect(result.systemPrompt).toContain('FLOCK INBOX');
    expect(result.systemPrompt).toContain('flock_todo_add');
    expect(result.systemPrompt).toContain('flock_todo_list');
    expect(result.systemPrompt).toContain('flock_todo_complete');
    expect(result.systemPrompt).toContain('Never silently ignore');
  });

  it('includes structured base instructions (role, collaboration, work, workspace)', () => {
    const result = composeSystemPrompt({
      identity: { agentId: 'test-1', agentName: 'TestAgent' },
    });

    expect(result.systemPrompt).toContain('Flock collaboration platform');
    expect(result.systemPrompt).toContain('## Your role');
    expect(result.systemPrompt).toContain('## Collaboration');
    expect(result.systemPrompt).toContain('## Doing work');
    expect(result.systemPrompt).toContain('working directory');
    // tool guidance is now folded into the base instructions, not a separate section
    expect(result.systemPrompt).toContain('Prefer specific tools');
  });

  it('renders room rules when room context is provided', () => {
    const result = composeSystemPrompt({
      identity: { agentId: 'test-1', agentName: 'TestAgent' },
      room: { roomId: 'r1', roomName: 'general', roomRules: 'Only reply in Chinese.' },
    });

    expect(result.systemPrompt).toContain('Room Rules:');
    expect(result.systemPrompt).toContain('Only reply in Chinese.');
  });
});
