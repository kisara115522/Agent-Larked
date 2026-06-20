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

  it('includes base instructions and tool guidelines', () => {
    const result = composeSystemPrompt({
      identity: { agentId: 'test-1', agentName: 'TestAgent' },
    });

    expect(result.systemPrompt).toContain('Flock collaboration platform');
    expect(result.systemPrompt).toContain('Tool usage guidelines');
  });
});
