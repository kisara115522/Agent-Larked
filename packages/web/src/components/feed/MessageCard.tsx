import { AgentAvatar } from '../agent/AgentAvatar';
import type { ReactionSummary, SenderType } from '@flock/shared';

interface MessageCardProps {
  id: string;
  from: string;
  fromName: string;
  content: string;
  mentions: string[];
  reactions: ReactionSummary[];
  createdAt: string;
  sequence?: number;
  senderType?: SenderType;
  currentUserId?: string;
  onReact?: (messageId: string, type: string) => void;
  onReply?: (messageId: string) => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString();
}

function renderContent(content: string): React.ReactNode {
  // Split on @mentions and render them as pills
  const parts = content.split(/(@[\w-]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      return (
        <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs bg-accent-muted text-accent font-medium">
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

const reactionEmojis: Record<string, string> = {
  agree: '👍',
  disagree: '👎',
  useful: '✅',
  question: '❓',
};

export function MessageCard({ id, from, fromName, content, mentions, reactions, createdAt, senderType, currentUserId, onReact, onReply }: MessageCardProps) {
  const isMentioned = currentUserId && mentions.includes(currentUserId);
  return (
    <div className={`group flex gap-3 px-4 py-3 hover:bg-surface-elevated/50 transition-colors ${isMentioned ? 'border-l-2 border-accent bg-accent-muted/10' : ''}`}>
      <AgentAvatar name={from} displayName={fromName} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-text">{fromName}</span>
          {senderType === 'human' && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-accent-muted text-accent font-medium">Human</span>
          )}
          <span className="text-[11px] text-text-muted font-mono">{formatTime(createdAt)}</span>
        </div>
        <p className="text-sm text-text/90 mt-1 leading-relaxed whitespace-pre-wrap break-words">
          {renderContent(content)}
        </p>
        {(reactions.length > 0 || onReact) && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {reactions.map(r => (
              <button
                key={r.type}
                onClick={() => onReact?.(id, r.type)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-border bg-surface hover:border-accent transition-colors"
              >
                <span>{reactionEmojis[r.type] ?? r.type}</span>
                <span className="text-text-muted">{r.count}</span>
              </button>
            ))}
            {onReact && (
              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                {Object.entries(reactionEmojis).map(([type, emoji]) => (
                  <button
                    key={type}
                    onClick={() => onReact(id, type)}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs hover:bg-surface-elevated transition-colors"
                    title={type}
                  >
                    {emoji}
                  </button>
                ))}
                {onReply && (
                  <button
                    onClick={() => onReply(id)}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-text-muted hover:bg-surface-elevated hover:text-text transition-colors"
                    title="Reply in thread"
                  >
                    💬
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
