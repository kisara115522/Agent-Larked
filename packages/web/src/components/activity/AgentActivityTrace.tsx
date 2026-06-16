import { useState } from 'react';
import type { AgentActivity } from '../../types/activity';
import { ActivityIcon } from './ActivityIcon';
import { ToolCallItem } from './ToolCallItem';

interface ActivityTraceProps {
  /** Activities for this agent turn, oldest-first */
  activities: AgentActivity[];
  /** Optional className for the container */
  className?: string;
}

/**
 * Collapsible activity timeline for an agent's reasoning/tool-use chain.
 *
 * Default: collapsed summary line (💭 thought · 🔧 N tools)
 * Expanded: full timeline with think text, tool calls, tool results.
 *
 * Reusable: works in DM and room views. Just pass activities[].
 */
export function AgentActivityTrace({ activities, className }: ActivityTraceProps) {
  const [expanded, setExpanded] = useState(false);

  if (activities.length === 0) return null;

  const thinkCount = activities.filter(a => a.activity_type === 'think').length;
  const toolCallCount = activities.filter(a => a.activity_type === 'tool_call').length;
  const errorCount = activities.filter(a => a.activity_type === 'error' || a.metadata.is_error).length;

  const parts: string[] = [];
  if (thinkCount > 0) parts.push(`💭 思考了 ${thinkCount} 次`);
  if (toolCallCount > 0) parts.push(`🔧 调用了 ${toolCallCount} 个工具`);
  if (errorCount > 0) parts.push(`❌ ${errorCount} 个错误`);
  const summary = parts.length > 0 ? parts.join(' · ') : `📋 ${activities.length} 步`;

  return (
    <div className={className}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors py-1 px-2 rounded-md hover:bg-surface-secondary w-full text-left"
      >
        <span className="text-[10px] transition-transform" style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          ▶
        </span>
        <span>{summary}</span>
        <span className="text-[10px] text-text-dim ml-auto">
          {expanded ? '收起' : '展开'}
        </span>
      </button>

      {expanded && (
        <div className="mt-1 ml-4 pl-2 border-l border-border-subtle space-y-0.5">
          {activities.map(activity => (
            <ActivityRow key={activity.id} activity={activity} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ activity }: { activity: AgentActivity }) {
  // Think activities: show collapsed text
  if (activity.activity_type === 'think') {
    return (
      <div className="flex items-start gap-2 py-1 text-xs text-text-muted">
        <ActivityIcon type="think" className="shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <span className="italic opacity-80">
            {activity.detail.length > 200 ? activity.detail.slice(0, 197) + '...' : activity.detail}
          </span>
        </div>
        <span className="text-[10px] text-text-dim shrink-0 tabular-nums">
          {new Date(activity.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>
    );
  }

  // Tool call / tool result
  if (activity.activity_type === 'tool_call' || activity.activity_type === 'tool_result') {
    return <ToolCallItem activity={activity} />;
  }

  // Status change / error / message
  return (
    <div className="flex items-start gap-2 py-1 text-xs text-text-muted">
      <ActivityIcon type={activity.activity_type} className="shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <span>{activity.detail.slice(0, 200)}</span>
      </div>
      <span className="text-[10px] text-text-dim shrink-0 tabular-nums">
        {new Date(activity.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
    </div>
  );
}
