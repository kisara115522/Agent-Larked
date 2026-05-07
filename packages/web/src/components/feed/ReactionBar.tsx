import type { ReactionSummary } from '@flock/shared';

const reactionEmojis: Record<string, string> = {
  agree: '👍',
  disagree: '👎',
  useful: '✅',
  question: '❓',
};

interface ReactionBarProps {
  reactions: ReactionSummary[];
  onReact?: (type: string) => void;
}

export function ReactionBar({ reactions, onReact }: ReactionBarProps) {
  if (reactions.length === 0 && !onReact) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {reactions.map(r => (
        <button
          key={r.type}
          onClick={() => onReact?.(r.type)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-border bg-surface hover:border-accent transition-colors"
        >
          <span>{reactionEmojis[r.type] ?? r.type}</span>
          <span className="text-text-muted">{r.count}</span>
        </button>
      ))}
      {onReact && (
        <button
          onClick={() => {}}
          className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-text-muted hover:bg-surface-elevated hover:text-text transition-colors"
          title="Add reaction"
        >
          +
        </button>
      )}
    </div>
  );
}
