import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { useMentions } from '../context/MentionContext';
import { get, post } from '../api/client';
import { MessageCard } from '../components/feed/MessageCard';
import type { Message, GetMessagesResponse } from '@flock/shared';

interface Room {
  id: string;
  name: string;
  member_count: number;
}

interface FeedItem extends Message {
  room_name: string;
}

export function FeedPage() {
  const { token } = useAuth();
  const { subscribe } = useSSE();
  const { totalUnread } = useMentions();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFeed = useCallback(async () => {
    if (!token) return;
    try {
      // 1. Get all rooms
      const { rooms } = await get<{ rooms: Room[] }>('/rooms', token);
      if (rooms.length === 0) {
        setMessages([]);
        return;
      }

      // 2. Fetch recent messages from each room (5 per room)
      const results = await Promise.allSettled(
        rooms.map(room =>
          get<GetMessagesResponse>(`/rooms/${room.id}/messages?limit=5`, token)
            .then(res => ({ room, messages: res.messages }))
        )
      );

      // 3. Combine and sort by created_at DESC
      const allMessages: FeedItem[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          for (const msg of result.value.messages) {
            allMessages.push({
              ...msg,
              room_name: result.value.room.name,
            });
          }
        }
      }
      allMessages.sort((a, b) => b.created_at.localeCompare(a.created_at));
      setMessages(allMessages.slice(0, 50));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadFeed();
  }, [token, loadFeed]);

  // SSE: refresh feed on new messages or mentions
  useEffect(() => {
    return subscribe((event) => {
      if (event.event === 'room_message' || event.event === 'mention') {
        loadFeed();
      }
    });
  }, [subscribe, loadFeed]);

  const handleReact = async (messageId: string, type: string) => {
    if (!token) return;
    try {
      await post(`/messages/${messageId}/reactions`, token, { type });
      loadFeed();
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
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Feed</h2>
          {totalUnread > 0 && (
            <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center">
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </div>
        <p className="text-sm text-text-muted">Messages from your rooms</p>
      </header>
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <p className="text-3xl mb-3">💬</p>
            <p className="text-sm text-text-muted">No messages yet</p>
            <p className="text-xs text-text-muted mt-1">Join a room to see messages here</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {messages.map(msg => (
              <div key={msg.id}>
                <div className="px-4 pt-2 pb-0">
                  <button
                    onClick={() => navigate(`/rooms/${msg.room_id}`)}
                    className="text-[10px] text-accent font-medium uppercase tracking-wider hover:underline"
                  >
                    {msg.room_name}
                  </button>
                </div>
                <MessageCard
                  id={msg.id}
                  from={msg.from}
                  fromName={msg.from_display_name || msg.from_name || msg.from}
                  content={msg.content}
                  mentions={msg.mentions}
                  reactions={msg.reactions}
                  createdAt={msg.created_at}
                  senderType={msg.sender_type}
                  onReact={handleReact}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
