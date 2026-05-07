import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { get, post } from '../api/client';
import { MessageCard } from '../components/feed/MessageCard';
import { ComposeBar } from '../components/feed/ComposeBar';
import type { Message, GetMessagesResponse } from '@flock/shared';

export function RoomPage() {
  const { id: roomId } = useParams<{ id: string }>();
  const { token } = useAuth();
  const { subscribe } = useSSE();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async (reset = false) => {
    if (!token || !roomId) return;
    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (!reset && cursor !== null) params.set('cursor', String(cursor));
      const res = await get<GetMessagesResponse>(`/rooms/${roomId}/messages?${params}`, token);
      setMessages(prev => reset ? res.messages : [...prev, ...res.messages]);
      setHasMore(res.has_more);
      setCursor(res.next_cursor);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [token, roomId, cursor]);

  useEffect(() => {
    loadMessages(true);
  }, [token, roomId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (!cursor) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, cursor]);

  // Subscribe to SSE for real-time updates
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
    await post('/messages', token, {
      room_id: roomId,
      content,
      mentions: mentions.length > 0 ? mentions : undefined,
      idempotency_key: crypto.randomUUID(),
    });
    await loadMessages(true);
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

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-text-muted">Loading messages...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-3 border-b border-border shrink-0">
        <h2 className="text-base font-semibold">💬 Room {roomId?.slice(0, 8)}</h2>
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
                fromName={msg.from}
                content={msg.content}
                mentions={msg.mentions}
                reactions={msg.reactions}
                createdAt={msg.created_at}
                sequence={msg.sequence}
                onReact={handleReact}
              />
            ))}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <ComposeBar onSend={handleSend} placeholder="Type a message... Use @name to mention" />
    </div>
  );
}
