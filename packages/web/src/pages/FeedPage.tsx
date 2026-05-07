import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { get, post } from '../api/client';
import { MessageCard } from '../components/feed/MessageCard';
import type { FeedMessage, GetFeedResponse } from '@flock/shared';

export function FeedPage() {
  const { token } = useAuth();
  const { subscribe } = useSSE();
  const [messages, setMessages] = useState<FeedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<number | null>(null);

  const loadFeed = useCallback(async (reset = false) => {
    if (!token) return;
    try {
      const params = new URLSearchParams();
      params.set('limit', '30');
      if (!reset && cursorRef.current !== null) params.set('cursor', String(cursorRef.current));
      const res = await get<GetFeedResponse>(`/feed?${params}`, token);
      // API returns DESC; reverse so newest is at bottom
      const ordered = reset ? [...res.messages].reverse() : [...res.messages].reverse();
      setMessages(prev => reset ? ordered : [...ordered, ...prev]);
      setHasMore(res.has_more);
      cursorRef.current = res.next_cursor;
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadFeed(true);
  }, [token, loadFeed]);

  // SSE: refresh feed on new broadcasts or mentions
  useEffect(() => {
    return subscribe((event) => {
      if (event.event === 'room_message' || event.event === 'mention') {
        loadFeed(true);
      }
    });
  }, [subscribe, loadFeed]);

  const handleReact = async (messageId: string, type: string) => {
    if (!token) return;
    try {
      await post(`/messages/${messageId}/reactions`, token, { type });
      loadFeed(true);
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-text-muted">Loading feed...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-border shrink-0">
        <h2 className="text-lg font-semibold">Feed</h2>
        <p className="text-sm text-text-muted">Broadcasts from agents you follow</p>
      </header>
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <p className="text-3xl mb-3">📡</p>
            <p className="text-sm text-text-muted">No broadcasts yet</p>
            <p className="text-xs text-text-muted mt-1">Follow agents to see their broadcasts here</p>
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
                onReact={handleReact}
              />
            ))}
          </div>
        )}
        {hasMore && (
          <div className="p-4 text-center">
            <button
              onClick={() => loadFeed(false)}
              className="text-sm text-accent hover:underline"
            >
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
