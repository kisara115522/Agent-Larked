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
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function renderContent(content: string): React.ReactNode {
  const parts = content.split(/(@[\w-]+)/g);
  return parts.map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} className="text-accent bg-accent-muted px-1.5 py-px rounded-full font-semibold text-[12px] mx-px">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

const REACTIONS: Record<string, string> = {
  agree: '👍',
  disagree: '👎',
  useful: '✅',
  question: '❓',
};

export function MessageCard({
  id, from, fromName, content, mentions, reactions, createdAt,
  senderType, currentUserId, onReact, onReply,
}: MessageCardProps) {
  const isMentioned = !!(currentUserId && mentions.includes(currentUserId));

  return (
    <div
      className={`group relative flex gap-3.5 py-3 px-3 -mx-3 rounded-[12px] transition-all duration-200
        hover:bg-surface-elevated/30
        ${isMentioned ? 'bg-accent-muted/10 border-l-2 border-accent pl-[10px]' : ''}
      `}
    >
      <div className="shrink-0 pt-0.5">
        <AgentAvatar name={from} displayName={fromName} />
      </div>

      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-baseline gap-2 mb-1">
          <span className={`text-[13px] font-semibold leading-tight ${senderType === 'human' ? 'text-accent' : 'text-text'}`}>
            {fromName}
          </span>
          <span className="text-[10px] text-text-dim font-mono tabular-nums">{formatTime(createdAt)}</span>
        </div>

        {/* Body */}
        <p className="text-[13px] text-text/90 leading-[1.7] whitespace-pre-wrap break-words">
          {renderContent(content)}
        </p>

        {/* Reactions row */}
        {(reactions.length > 0 || onReact) && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {reactions.map(r => (
              <button
                key={r.type}
                onClick={() => onReact?.(id, r.type)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border border-border bg-surface hover:border-accent/60 hover:bg-accent-soft transition-colors duration-150"
              >
                <span>{REACTIONS[r.type] ?? r.type}</span>
                <span className="text-text-dim font-mono tabular-nums">{r.count}</span>
              </button>
            ))}

            {/* Action buttons — visible on hover */}
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-0.5 ml-1">
              {onReply && (
                <ActionBtn onClick={() => onReply(id)} title="回复">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 10a2 2 0 0 1-2 2H5l-3 2V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6z"/>
                  </svg>
                </ActionBtn>
              )}
              {onReact && Object.entries(REACTIONS).map(([type, emoji]) => (
                <ActionBtn key={type} onClick={() => onReact(id, type)} title={type}>
                  <span className="text-[11px]">{emoji}</span>
                </ActionBtn>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-6 h-6 rounded-full flex items-center justify-center text-text-dim hover:text-text hover:bg-surface-elevated transition-colors"
    >
      {children}
    </button>
  );
}
