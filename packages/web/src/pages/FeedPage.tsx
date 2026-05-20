import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { useMentions } from '../context/MentionContext';
import { get, post } from '../api/client';
import { MessageCard } from '../components/feed/MessageCard';
import { CreateRoomModal } from '../components/room/CreateRoomModal';
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
  const { token, human } = useAuth();
  const { subscribe } = useSSE();
  const { totalUnread } = useMentions();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateRoom, setShowCreateRoom] = useState(false);

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

  // Subscribe to all rooms for real-time SSE events
  const roomIdsRef = useRef<string[]>([]);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    get<{ rooms: Room[] }>('/rooms', token)
      .then(({ rooms }) => {
        if (cancelled) return;
        roomIdsRef.current = rooms.map(r => r.id);
        for (const roomId of roomIdsRef.current) {
          post(`/rooms/${roomId}/subscribe`, token).catch(() => {});
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      for (const roomId of roomIdsRef.current) {
        post(`/rooms/${roomId}/unsubscribe`, token).catch(() => {});
      }
    };
  }, [token]);

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
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
          <p className="text-sm text-text-dim font-medium">加载中</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-12 pt-12 pb-6 shrink-0" style={{ animation: 'fadeUp .4s ease-out' }}>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[36px] font-black tracking-tight leading-none" style={{ fontFamily: 'var(--font-display)' }}>
              Room
            </h1>
            {totalUnread > 0 && (
              <p className="text-[14px] text-accent mt-3 font-medium">{totalUnread} 条未读</p>
            )}
          </div>
          <button
            onClick={() => setShowCreateRoom(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-semibold bg-accent text-white hover:bg-accent-hover transition-colors duration-150"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
            新建 Room
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-12 pb-8">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[400px] text-center">
            <div className="relative w-20 h-20 mb-6">
              <div className="absolute inset-0 rounded-full border border-border" />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-dim">
                  <path d="M14 10a2 2 0 0 1-2 2H5l-3 2V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6z"/>
                </svg>
              </div>
            </div>
            <p className="text-[14px] text-text-muted font-medium">暂无消息</p>
            <p className="text-[12px] text-text-dim mt-2">加入一个 Room 查看消息</p>
          </div>
        ) : (
          <div className="space-y-1">
            {messages.map(msg => (
              <div key={msg.id} className="rounded-[12px] hover:bg-surface-elevated/30 transition-colors">
                <div className="px-4 pt-3 pb-0">
                  <button
                    onClick={() => navigate(`/rooms/${msg.room_id}`)}
                    className="text-[10px] text-accent font-semibold uppercase tracking-[0.12em] hover:text-accent-hover transition-colors"
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
                  currentUserId={human?.id}
                  onReact={handleReact}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      {showCreateRoom && token && (
        <CreateRoomModal
          token={token}
          onClose={() => setShowCreateRoom(false)}
          onCreated={() => { setShowCreateRoom(false); loadFeed(); }}
        />
      )}
    </div>
  );
}
