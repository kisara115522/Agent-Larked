import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { useMentions } from '../context/MentionContext';
import { get, post, put } from '../api/client';
import { MessageCard } from '../components/feed/MessageCard';
import { ComposeBar } from '../components/feed/ComposeBar';
import { ThreadView } from '../components/feed/ThreadView';
import { createIdempotencyKey } from '../utils/idempotency';
import type { Message, GetMessagesResponse } from '@flock/shared';

interface AgentOption {
  id: string;
  name: string;
  display_name?: string;
  status?: string;
}

interface RoomDetails {
  name: string;
  rules: string;
  rules_version: number;
  rules_updated_at: string | null;
  is_member?: boolean;
}

interface RoomRulesResponse {
  room_id: string;
  rules: string;
  rules_version: number;
  rules_updated_at: string | null;
}

export function sendHumanRoomMessage(token: string, roomId: string, content: string, mentions: string[]) {
  return post(`/rooms/${roomId}/messages`, token, {
    content,
    mentions: mentions.length > 0 ? mentions : undefined,
    idempotency_key: createIdempotencyKey(),
  });
}

export function saveRoomRules(token: string, roomId: string, rules: string): Promise<RoomRulesResponse> {
  return put<RoomRulesResponse>(`/rooms/${roomId}/rules`, token, { rules });
}

export function RoomPage() {
  const { id: roomId } = useParams<{ id: string }>();
  const { token, human } = useAuth();
  const { subscribe, connected } = useSSE();
  const { clearRoom } = useMentions();
  const navigate = useNavigate();

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
  const [roomRules, setRoomRules] = useState('');
  const [roomRulesVersion, setRoomRulesVersion] = useState(0);
  const [roomRulesUpdatedAt, setRoomRulesUpdatedAt] = useState<string | null>(null);
  const [isMember, setIsMember] = useState(true);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<number | null>(null);
  const [threadMessageId, setThreadMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [memberRefreshKey, setMemberRefreshKey] = useState(0);

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
    get<RoomDetails>(`/rooms/${roomId}`, token)
      .then(r => {
        setRoomName(r.name);
        setRoomRules(r.rules ?? '');
        setRoomRulesVersion(r.rules_version ?? 0);
        setRoomRulesUpdatedAt(r.rules_updated_at ?? null);
        setIsMember(r.is_member !== false);
      })
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
      await sendHumanRoomMessage(token, roomId, content, mentions);
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

  const handleJoin = async () => {
    if (!token || !roomId) return;
    try {
      await post(`/rooms/${roomId}/join`, token);
      setIsMember(true);
      await loadMessages(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join room');
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
          <button
            onClick={() => navigate('/feed')}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-surface-elevated text-text-muted border border-border hover:border-text-dim transition-colors"
            title="返回 Room"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 4L6 8l4 4"/></svg>
          </button>
          <div className="w-8 h-8 rounded-[8px] bg-accent-muted flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
              <path d="M14 10a2 2 0 0 1-2 2H5l-3 2V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6z"/>
            </svg>
          </div>
          <h3 className="text-[15px] font-semibold">{roomName || `Room ${roomId?.slice(0, 8)}`}</h3>
          <div className="ml-auto flex items-center gap-2">
            {isMember ? (
              <>
                <button
                  onClick={() => setShowAddAgent(true)}
                  className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-accent text-white hover:bg-accent-hover transition-colors"
                >
                  添加 Agent
                </button>
                <button
                  onClick={() => setShowRules(true)}
                  className="px-3 py-1.5 rounded-full text-[11px] font-semibold text-text-dim border border-border hover:border-accent hover:text-accent transition-all duration-200"
                >
                  规则
                </button>
                <button
                  onClick={handleLeave}
                  className="px-3 py-1.5 rounded-full text-[11px] font-semibold text-text-dim border border-border hover:border-error hover:text-error transition-all duration-200"
                >
                  离开
                </button>
              </>
            ) : (
              <button
                onClick={handleJoin}
                className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-accent text-white hover:bg-accent-hover transition-all duration-200"
              >
                加入
              </button>
            )}
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

        {isMember ? (
          <ComposeBar
            onSend={handleSend}
            placeholder="输入消息... 用 @名字 提及"
            roomId={roomId}
            token={token ?? undefined}
            refreshKey={memberRefreshKey}
          />
        ) : (
          <div className="px-8 py-4 border-t border-border bg-surface flex items-center justify-between">
            <span className="text-[13px] text-text-muted">加入 Room 后可以发送消息和创建任务</span>
            <button onClick={handleJoin} className="px-4 py-2 rounded-full text-[12px] font-semibold bg-accent text-white hover:bg-accent-hover transition-colors">加入 Room</button>
          </div>
        )}
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
      {showAddAgent && token && roomId && (
        <AddAgentToRoomModal
          token={token}
          roomId={roomId}
          onClose={() => setShowAddAgent(false)}
          onAdded={() => {
            setShowAddAgent(false);
            setMemberRefreshKey(value => value + 1);
            loadMessages(true);
          }}
        />
      )}
      {showRules && token && roomId && (
        <RoomRulesModal
          token={token}
          roomId={roomId}
          initialRules={roomRules}
          version={roomRulesVersion}
          updatedAt={roomRulesUpdatedAt}
          onClose={() => setShowRules(false)}
          onSaved={(result) => {
            setRoomRules(result.rules);
            setRoomRulesVersion(result.rules_version);
            setRoomRulesUpdatedAt(result.rules_updated_at);
            setShowRules(false);
          }}
        />
      )}
    </div>
  );
}

function RoomRulesModal({
  token,
  roomId,
  initialRules,
  version,
  updatedAt,
  onClose,
  onSaved,
}: {
  token: string;
  roomId: string;
  initialRules: string;
  version: number;
  updatedAt: string | null;
  onClose: () => void;
  onSaved: (result: RoomRulesResponse) => void;
}) {
  const [rules, setRules] = useState(initialRules);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const changed = rules !== initialRules;

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      const result = await saveRoomRules(token, roomId, rules);
      onSaved(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '规则保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-2xl max-h-[84vh] bg-surface border border-border rounded-[10px] shadow-xl flex flex-col"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-start gap-3">
          <div>
            <h3 className="text-[15px] font-semibold">Room 规则</h3>
            <div className="text-[11px] text-text-dim mt-1">
              v{version}{updatedAt ? ` · ${new Date(updatedAt).toLocaleString()}` : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-auto w-8 h-8 rounded-full border border-border text-text-muted hover:text-text hover:bg-surface-elevated transition-colors"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="p-5 flex-1 min-h-0">
          <textarea
            value={rules}
            onChange={event => setRules(event.target.value)}
            placeholder="写下这个 Room 内 agent 必须遵守的协作规则..."
            className="w-full h-[320px] resize-none px-3 py-3 rounded-[10px] border border-border bg-surface-elevated text-[13px] leading-6 text-text placeholder:text-text-dim outline-none focus:border-accent"
          />
          <div className="mt-2 text-[11px] text-text-dim">
            保存后版本会递增；agent 下次 `flock_room_sync` 只会在版本变化时收到完整规则。
          </div>
          {error && (
            <div className="mt-3 px-3 py-2 rounded-[8px] bg-error-muted text-error text-[12px]">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full text-[12px] font-semibold text-text-muted hover:text-text hover:bg-surface-elevated transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !changed}
            className="px-4 py-2 rounded-full text-[12px] font-semibold bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors"
          >
            {saving ? '保存中' : '保存规则'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddAgentToRoomModal({
  token,
  roomId,
  onClose,
  onAdded,
}: {
  token: string;
  roomId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [members, setMembers] = useState<AgentOption[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [agentsRes, membersRes] = await Promise.all([
        get<{ agents: AgentOption[] }>('/agents?limit=100', token),
        get<{ members: AgentOption[] }>(`/rooms/${roomId}/members`, token),
      ]);
      setAgents(agentsRes.agents);
      setMembers(membersRes.members);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Agent 列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [roomId, token]);

  useEffect(() => {
    load();
  }, [load]);

  const memberIds = new Set(members.map(member => member.id));
  const candidates = agents.filter(agent => !memberIds.has(agent.id));
  const filtered = candidates.filter(agent => {
    const text = `${agent.name} ${agent.display_name ?? ''}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });

  const addAgent = async (agentId: string) => {
    try {
      setAddingId(agentId);
      await post(`/rooms/${roomId}/members`, token, { agent_id: agentId });
      await load();
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    } finally {
      setAddingId('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-lg max-h-[80vh] bg-surface border border-border rounded-[10px] shadow-xl flex flex-col"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center gap-3">
          <div>
            <h3 className="text-[15px] font-semibold">添加 Agent 到 Room</h3>
            <p className="text-[12px] text-text-muted mt-1">加入后才能被 @ 提及和接收 Room 上下文。</p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto w-8 h-8 rounded-full border border-border text-text-muted hover:text-text hover:bg-surface-elevated transition-colors"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="p-4 border-b border-border">
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索 agent 名称"
            className="w-full px-3 py-2 rounded-[8px] border border-border bg-surface-elevated text-[13px] outline-none focus:border-accent"
          />
        </div>

        {error && (
          <div className="mx-4 mt-4 px-3 py-2 rounded-[8px] bg-error-muted text-error text-[12px]">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="py-10 text-center text-[13px] text-text-muted">加载中</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-[13px] text-text-muted font-medium">没有可添加的 Agent</p>
              <p className="text-[12px] text-text-dim mt-1">可能已经都在这个 Room 里。</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map(agent => (
                <div key={agent.id} className="flex items-center gap-3 px-3 py-2.5 rounded-[8px] hover:bg-surface-elevated/60">
                  <div className="w-8 h-8 rounded-full bg-accent-muted text-accent flex items-center justify-center text-[11px] font-bold">
                    {(agent.display_name || agent.name).slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold truncate">{agent.display_name || agent.name}</div>
                    <div className="text-[11px] text-text-dim font-mono truncate">@{agent.name}</div>
                  </div>
                  <span className="text-[10px] text-text-dim">{agent.status ?? 'dormant'}</span>
                  <button
                    onClick={() => addAgent(agent.id)}
                    disabled={addingId === agent.id}
                    className="px-3 py-1.5 rounded-full bg-accent text-white text-[11px] font-semibold hover:bg-accent-hover disabled:opacity-40 transition-colors"
                  >
                    {addingId === agent.id ? '添加中' : '添加'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
