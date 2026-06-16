import type { AgentActivity } from '../../types/activity';
import { ActivityIcon } from './ActivityIcon';

function summarizeInput(input: Record<string, unknown> | undefined, maxLen = 120): string {
  if (!input) return '';
  const keys = Object.keys(input);
  if (keys.length === 0) return '';
  const parts = keys.map(k => {
    const val = input[k];
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    return `${k}: ${str.length > 60 ? str.slice(0, 57) + '...' : str}`;
  });
  const joined = parts.join(', ');
  return joined.length > maxLen ? joined.slice(0, maxLen - 3) + '...' : joined;
}

/**
 * Renders a single tool_call activity: tool name + input summary.
 * Also handles tool_result with error styling.
 */
export function ToolCallItem({ activity }: { activity: AgentActivity }) {
  const isResult = activity.activity_type === 'tool_result';
  const isError = activity.metadata.is_error === true;

  return (
    <div className={`flex items-start gap-2 py-1 text-xs ${isError ? 'text-red-400' : 'text-text-muted'}`}>
      <ActivityIcon type={activity.activity_type} className="shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <span className="font-mono font-medium text-text">
          {activity.detail.slice(0, 80)}
        </span>
        {!isResult && activity.metadata.input && (
          <span className="ml-1 opacity-70">
            ({summarizeInput(activity.metadata.input)})
          </span>
        )}
        {isError && (
          <span className="ml-1 text-red-400 font-medium">[error]</span>
        )}
      </div>
      <span className="text-[10px] text-text-dim shrink-0 tabular-nums">
        {new Date(activity.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
    </div>
  );
}
