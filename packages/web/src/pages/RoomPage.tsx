import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { useMentions } from '../context/MentionContext';
import { get, post } from '../api/client';
import { MessageCard } from '../components/feed/MessageCard';
import { ComposeBar } from '../components/feed/ComposeBar';
import { ThreadView } from '../components/feed/ThreadView';
import type { Message, GetMessagesResponse } from '@flock/shared';

export function RoomPage() {
  const { id: roomId } = useParams<{ id: string }>();
  const { token, human } = useAuth();
  const { subscribe, connected } = useSSE();
  const { clearRoom } = useMentions();

  // Prevent browser from restoring scroll position on refresh — we handle it ourselves
  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      const prev = window.history.scrollRestoration;
      window.history.scrollRestoration = 'manual';
      return () => { window.history.scrollRestoration = prev; };
    }
  }, []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [roomName, setRoomName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<number | null>(null);
  const [threadMessageId, setThreadMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Cleanup error timeout on unmount
  useEffect(() => {
    return () => { if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current); };
  }, []);

  // Track scroll position to show/hide scroll-to-bottom button
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      setShowScrollButton(distanceFromBottom > 200);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const loadMessages = useCallback(async (reset = false) => {
    if (!token || !roomId) return;
    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (!reset && cursorRef.current !== null) params.set('cursor', String(cursorRef.current));
      // Don't auto-scroll when loading older messages
      if (!reset) shouldScrollRef.current = false;
      const res = await get<GetMessagesResponse>(`/rooms/${roomId}/messages?${params}`, token);
      // API returns DESC (newest first); reverse so newest is at bottom like standard IM
      const ordered = [...res.messages].reverse();
      setMessages(prev => reset ? ordered : [...ordered, ...prev]);
      setHasMore(res.has_more);
      cursorRef.current = res.next_cursor;
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [token, roomId]);

  // Fetch room name
  useEffect(() => {
    if (!token || !roomId) return;
    get<{ name: string }>(`/rooms/${roomId}`, token)
      .then(r => setRoomName(r.name))
      .catch(() => {});
  }, [token, roomId]);

  // Clear unread mentions when entering this room
  useEffect(() => {
    if (roomId) clearRoom(roomId);
  }, [roomId, clearRoom]);

  useEffect(() => {
    loadMessages(true);
    // Subscribe to room SSE events so we receive real-time messages
    if (token && roomId) {
      post(`/rooms/${roomId}/subscribe`, token).catch(() => {});
      return () => { post(`/rooms/${roomId}/unsubscribe`, token).catch(() => {}); };
    }
  }, [token, roomId, loadMessages, connected]);

  // Auto-scroll: instant on initial load, smooth on new messages, skip when loading older
  const shouldScrollRef = useRef(true);
  const isInitialLoadRef = useRef(true);

  useEffect(() => {
    if (!shouldScrollRef.current) { shouldScrollRef.current = true; return; }
    const end = messagesEndRef.current;
    if (!end) return;
    if (isInitialLoadRef.current) {
      // Instant: use scrollTo on the scrollable parent — no animation
      const container = end.parentElement;
      if (container) container.scrollTop = container.scrollHeight;
      isInitialLoadRef.current = false;
    } else {
      end.scrollIntoView({ behavior: 'smooth' });
    }
    shouldScrollRef.current = true;
  }, [messages]);

  // Close thread panel on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && threadMessageId) {
        setThreadMessageId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [threadMessageId]);

  useEffect(() => {
    const unsub = subscribe(event => {
      if (event.event === 'room_message') {
        const data = event.data as { room_id: string };
        if (data.room_id === roomId) {
          loadMessages(true);
        }
      }
    });
    return unsub;
  }, [subscribe, roomId, loadMessages]);

  const handleSend = async (content: string, mentions: string[]) => {
    if (!token || !roomId) return;
    try {
      await post('/messages', token, {
        room_id: roomId,
        content,
        mentions: mentions.length > 0 ? mentions : undefined,
        idempotency_key: crypto.randomUUID(),
      });
      await loadMessages(true);
    } catch (err) {
      console.error('Failed to send message:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = setTimeout(() => setError(null), 5000);
    }
  };

  const handleReact = async (messageId: string, type: string) => {
    if (!token) return;
    try {
      await post(`/messages/${messageId}/reactions`, token, { type });
      loadMessages(true);
    } catch {
      // ignore
    }
  };

  const handleLeave = async () => {
    if (!token || !roomId) return;
    try {
      await post(`/rooms/${roomId}/leave`, token);
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave room');
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = setTimeout(() => setError(null), 5000);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
          <p className="text-sm text-text-dim font-medium">加载中</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      <div className={`flex-1 flex flex-col ${threadMessageId ? 'border-r border-border' : ''}`}>
        {/* Header */}
        <div className="px-8 py-4 border-b border-border flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-[8px] bg-accent-muted flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
              <path d="M14 10a2 2 0 0 1-2 2H5l-3 2V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6z"/>
            </svg>
          </div>
          <h3 className="text-[15px] font-semibold">{roomName || `Room ${roomId?.slice(0, 8)}`}</h3>
          <div className="ml-auto">
            <button
              onClick={handleLeave}
              className="px-3 py-1.5 rounded-full text-[11px] font-semibold text-text-dim border border-border hover:border-error hover:text-error transition-all duration-200"
            >
              离开
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto relative px-8 py-6">
          {hasMore && (
            <div className="pb-4 text-center">
              <button
                onClick={() => loadMessages(false)}
                className="text-[12px] text-accent font-medium hover:text-accent-hover transition-colors"
              >
                加载更早的消息
              </button>
            </div>
          )}
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-full border border-border flex items-center justify-center mb-4">
                <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-dim">
                  <path d="M14 10a2 2 0 0 1-2 2H5l-3 2V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6z"/>
                </svg>
              </div>
              <p className="text-[13px] text-text-muted font-medium">暂无消息</p>
              <p className="text-[12px] text-text-dim mt-1">发送第一条消息吧</p>
            </div>
          ) : (
            <div className="space-y-1">
              {messages.map(msg => (
                <MessageCard
                  key={msg.id}
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
                  onReply={messageId => {
                    setThreadMessageId(messageId);
                  }}
                />
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
          {showScrollButton && (
            <button
              onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
              className="sticky bottom-4 left-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-surface-elevated border border-border shadow-md flex items-center justify-center text-text-muted hover:text-accent transition-colors z-10"
              title="Scroll to bottom"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6l4 4 4-4"/></svg>
            </button>
          )}
        </div>

        <ComposeBar onSend={handleSend} placeholder="输入消息... 用 @名字 提及" roomId={roomId} token={token ?? undefined} />
        {error && (
          <div className="px-6 py-2.5 bg-error-muted border-t border-error/20 text-error text-[12px] flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 text-error/60 hover:text-error transition-colors">✕</button>
          </div>
        )}
      </div>

      {threadMessageId && (
        <div className="w-96 shrink-0">
          <ThreadView
            messageId={threadMessageId}
            onClose={() => setThreadMessageId(null)}
          />
        </div>
      )}
    </div>
  );
}
