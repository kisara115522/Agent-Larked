import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { get, post } from '../../api/client';
import { MessageCard } from './MessageCard';
import { ComposeBar } from './ComposeBar';
import type { Message, GetThreadResponse } from '@flock/shared';

interface ThreadViewProps {
  messageId: string;
  onClose: () => void;
}

export function ThreadView({ messageId, onClose }: ThreadViewProps) {
  const { token, human } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  const loadThread = useCallback(async () => {
    if (!token) return;
    try {
      const res = await get<GetThreadResponse>(`/messages/${messageId}/thread`, token);
      setMessages(res.messages);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [token, messageId]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  const handleSend = async (content: string, mentions: string[]) => {
    if (!token) return;
    // Use the root message's room_id for the reply. The thread's first message
    // (index 0) is always the root. reply_to points to the root messageId prop,
    // not the last message in the chain.
    const root = messages[0];
    if (!root) return;
    try {
      await post('/messages', token, {
        room_id: root.room_id,
        content,
        mentions: mentions.length > 0 ? mentions : undefined,
        reply_to: messageId,
        idempotency_key: crypto.randomUUID(),
      });
      await loadThread();
    } catch {
      // ignore — ComposeBar handles UI feedback
    }
  };

  const handleReact = async (msgId: string, type: string) => {
    if (!token) return;
    try {
      await post(`/messages/${msgId}/reactions`, token, { type });
      loadThread();
    } catch {
      // ignore
    }
  };

  return (
    <div className="h-full flex flex-col bg-surface border-l border-border">
      <header className="px-4 py-3 border-b border-border flex items-center gap-2 shrink-0">
        <button
          onClick={onClose}
          className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-elevated transition-colors"
        >
          ✕
        </button>
        <h3 className="text-sm font-semibold">话题</h3>
        <span className="text-xs text-text-dim font-mono">{messageId.slice(0, 8)}</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-text-muted">加载中...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-text-muted">暂无回复</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {messages.map((msg, i) => (
              <div key={msg.id} className={i === 0 ? 'bg-accent-muted/20' : ''}>
                {i === 0 && (
                  <div className="px-4 pt-2 pb-0">
                    <span className="text-[10px] text-accent font-medium uppercase tracking-wider">原始消息</span>
                  </div>
                )}
                <MessageCard
                  id={msg.id}
                  from={msg.from}
                  fromName={msg.from_display_name || msg.from_name || msg.from}
                  content={msg.content}
                  mentions={msg.mentions}
                  reactions={msg.reactions}
                  createdAt={msg.created_at}
                  sequence={msg.sequence}
                  senderType={msg.sender_type}
                  currentUserId={human?.id}
                  onReact={handleReact}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <ComposeBar onSend={handleSend} placeholder="回复话题..." roomId={messages[0]?.room_id} token={token ?? undefined} />
    </div>
  );
}
