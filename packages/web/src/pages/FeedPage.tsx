import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { useMentions } from '../context/MentionContext';
import { get, post } from '../api/client';
import { MessageCard } from '../components/feed/MessageCard';
import { CreateRoomModal } from '../components/room/CreateRoomModal';
import { EmptyState, ErrorState, Metric, MetricStrip, PageHeader, PageLoader, PageShell, Panel } from '../components/ui/PageState';
import type { Message, GetMessagesResponse } from '@flock/shared';

interface Room {
  id: string;
  name: string;
  member_count: number;
  visibility?: string;
  created_at?: string;
  is_member?: boolean;
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
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [loadError, setLoadError] = useState('');

  const loadFeed = useCallback(async () => {
    if (!token) return;
    try {
      // 1. Get all rooms
      const { rooms } = await get<{ rooms: Room[] }>('/rooms', token);
      setRooms(rooms);
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
      setLoadError('');
    } catch (error) {
      setMessages([]);
      setRooms([]);
      setLoadError(error instanceof Error ? error.message : 'Room 数据加载失败');
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
    return <PageLoader />;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader
        title="Room"
        eyebrow="Workspace"
        subtitle={totalUnread > 0 ? <span className="text-accent">{totalUnread} 条未读</span> : '最近消息和已加入的协作空间'}
        action={
          <button
            onClick={() => setShowCreateRoom(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-semibold bg-accent text-white hover:bg-accent-hover transition-colors duration-150"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
            新建 Room
          </button>
        }
      />

      <PageShell scroll={false}>
        {loadError && <div className="mb-4"><ErrorState message={loadError} onRetry={loadFeed} /></div>}
        <MetricStrip className="mb-5">
          <Metric label="Room" value={rooms.length} detail={`${rooms.filter(room => room.is_member).length} 已加入`} tone="accent" />
          <Metric label="最近消息" value={messages.length} detail="聚合最近 50 条" tone={messages.length > 0 ? 'success' : 'muted'} />
          <Metric label="未读" value={totalUnread} detail="mentions + room unread" tone={totalUnread > 0 ? 'warning' : 'muted'} />
        </MetricStrip>

        <div className="h-[calc(100%-124px)] grid grid-cols-[300px_minmax(0,1fr)] gap-5 max-[980px]:grid-cols-1">
          <Panel title="Rooms" meta={`${rooms.length}`}>
            <div className="flex-1 overflow-y-auto p-2">
              {rooms.length > 0 ? rooms.map(room => (
                <button
                  key={room.id}
                  onClick={() => navigate(`/rooms/${room.id}`)}
                  className="w-full text-left px-3 py-2.5 rounded-[6px] hover:bg-surface-elevated transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${room.is_member ? 'bg-success' : 'bg-text-dim'}`} />
                    <span className="text-[13px] font-medium truncate flex-1">{room.name}</span>
                    <span className="text-[10px] text-text-dim font-mono">{room.member_count}</span>
                  </div>
                  <div className="text-[10px] text-text-dim mt-1 pl-3.5">
                    {room.is_member ? '已加入' : '未加入'}
                  </div>
                </button>
              )) : (
                <EmptyState
                  className="py-10"
                  title="还没有 Room"
                  description="创建 Room 后，Agent 和人类可以在里面协作。"
                />
              )}
            </div>
          </Panel>

          <Panel title="最近消息" meta={`${messages.length}`} className="min-h-0">
            <section className="h-full overflow-y-auto">
            {messages.length === 0 ? (
              <EmptyState
                className="h-[400px]"
                title={rooms.length > 0 ? '还没有最近消息' : '还没有 Room'}
                description={rooms.length > 0 ? '进入左侧 Room 发送第一条消息，消息会回到这里汇总。' : '新建一个 Room 后，最近消息会在这里汇总。'}
                action={
                  <button
                    onClick={() => setShowCreateRoom(true)}
                    className="px-4 py-2 rounded-full bg-accent text-white text-[12px] font-semibold hover:bg-accent-hover transition-colors"
                  >
                    新建 Room
                  </button>
                }
              />
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
          </section>
          </Panel>
        </div>
      </PageShell>
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
