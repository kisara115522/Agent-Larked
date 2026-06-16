import type { ActivityType } from '../../types/activity';

const ICONS: Record<ActivityType, { emoji: string; label: string }> = {
  message: { emoji: '💬', label: 'Message' },
  think: { emoji: '💭', label: 'Thinking' },
  tool_call: { emoji: '🔧', label: 'Tool call' },
  tool_result: { emoji: '✅', label: 'Tool result' },
  status_change: { emoji: '⚡', label: 'Status' },
  error: { emoji: '❌', label: 'Error' },
};

export function ActivityIcon({ type, className }: { type: ActivityType; className?: string }) {
  const icon = ICONS[type] ?? { emoji: '❓', label: type };
  return (
    <span className={className} title={icon.label} role="img" aria-label={icon.label}>
      {icon.emoji}
    </span>
  );
}
