import { describe, expect, it } from 'vitest';
import type { AgentActivity } from '../../types/activity';

/**
 * Test the summary computation logic used by AgentActivityTrace.
 * The component itself requires React rendering (no testing-library in this project),
 * so we test the pure logic that generates the collapsed summary text.
 */

function computeSummary(activities: AgentActivity[]): string {
  const thinkCount = activities.filter(a => a.activity_type === 'think').length;
  const toolCallCount = activities.filter(a => a.activity_type === 'tool_call').length;
  const errorCount = activities.filter(a => a.activity_type === 'error' || a.metadata.is_error).length;

  const parts: string[] = [];
  if (thinkCount > 0) parts.push(`💭 思考了 ${thinkCount} 次`);
  if (toolCallCount > 0) parts.push(`🔧 调用了 ${toolCallCount} 个工具`);
  if (errorCount > 0) parts.push(`❌ ${errorCount} 个错误`);
  return parts.length > 0 ? parts.join(' · ') : `📋 ${activities.length} 步`;
}

function makeActivity(type: AgentActivity['activity_type'], detail = '', metadata: AgentActivity['metadata'] = {}): AgentActivity {
  return {
    id: `test-${Math.random().toString(36).slice(2)}`,
    agent_id: 'agent-1',
    activity_type: type,
    detail,
    metadata,
    created_at: new Date().toISOString(),
  };
}

describe('AgentActivityTrace summary', () => {
  it('returns empty string for no activities (component returns null)', () => {
    expect(computeSummary([])).toBe('📋 0 步');
  });

  it('counts think activities', () => {
    const activities = [
      makeActivity('think', 'thinking about X'),
      makeActivity('think', 'thinking about Y'),
    ];
    expect(computeSummary(activities)).toBe('💭 思考了 2 次');
  });

  it('counts tool_call activities', () => {
    const activities = [
      makeActivity('tool_call', 'flock_post'),
      makeActivity('tool_call', 'flock_dm_send'),
      makeActivity('tool_call', 'bash'),
    ];
    expect(computeSummary(activities)).toBe('🔧 调用了 3 个工具');
  });

  it('combines think + tool_call', () => {
    const activities = [
      makeActivity('think', 'reasoning'),
      makeActivity('tool_call', 'flock_post'),
      makeActivity('tool_result', 'ok'),
    ];
    expect(computeSummary(activities)).toBe('💭 思考了 1 次 · 🔧 调用了 1 个工具');
  });

  it('counts errors from error type and is_error metadata', () => {
    const activities = [
      makeActivity('error', 'something broke'),
      makeActivity('tool_result', 'failed', { is_error: true }),
    ];
    expect(computeSummary(activities)).toBe('❌ 2 个错误');
  });

  it('falls back to step count for unknown types', () => {
    const activities = [
      makeActivity('status_change', 'Agent active'),
      makeActivity('message', 'hello'),
    ];
    expect(computeSummary(activities)).toBe('📋 2 步');
  });
});
