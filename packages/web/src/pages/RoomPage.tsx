import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { get, post } from '../api/client';
import { MessageCard } from '../components/feed/MessageCard';
import { ComposeBar } from '../components/feed/ComposeBar';
import { ThreadView } from '../components/feed/ThreadView';
import type { Message, GetMessagesResponse } from '@flock/shared';

export function RoomPage() {
  const { id: roomId } = useParams<{ id: string }>();
  const { token } = useAuth();
  const { subscribe, connected } = useSSE();

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

  // Cleanup error timeout on unmount
  useEffect(() => {
    return () => { if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current); };
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
        <p className="text-sm text-text-muted">Loading messages...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      <div className={`flex-1 flex flex-col ${threadMessageId ? 'border-r border-border' : ''}`}>
        <header className="px-6 py-3 border-b border-border shrink-0 flex items-center justify-between">
          <h2 className="text-base font-semibold">💬 {roomName || `Room ${roomId?.slice(0, 8)}`}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleLeave}
              className="px-2.5 py-1 text-xs text-text-muted border border-border rounded-md hover:border-error hover:text-error transition-colors"
            >
              Leave
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {hasMore && (
            <div className="p-4 text-center">
              <button
                onClick={() => loadMessages(false)}
                className="text-sm text-accent hover:underline"
              >
                Load older messages
              </button>
            </div>
          )}
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <p className="text-3xl mb-3">💬</p>
              <p className="text-sm text-text-muted">No messages yet</p>
              <p className="text-xs text-text-muted mt-1">Send the first message!</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
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
                  onReact={handleReact}
                  onReply={messageId => {
                    setThreadMessageId(messageId);
                  }}
                />
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <ComposeBar onSend={handleSend} placeholder="Type a message... Use @name to mention" roomId={roomId} token={token ?? undefined} />
        {error && (
          <div className="px-4 py-2 bg-error/10 border-t border-error/20 text-error text-xs flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 text-error/60 hover:text-error">✕</button>
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
