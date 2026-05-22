import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DirectChatSummary, DirectMessage } from '@flock/shared';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { get, post } from '../api/client';
import { AgentAvatar } from '../components/agent/AgentAvatar';
import { StatusIndicator } from '../components/agent/StatusIndicator';
import { EmptyState, PageHeader } from '../components/ui/PageState';

interface Agent {
  id: string;
  name: string;
  display_name: string;
  status: string;
  capabilities: string[];
}

interface DirectMessagesResponse {
  messages: DirectMessage[];
  next_cursor: number | null;
  has_more: boolean;
}

export function CommandPage() {
  const { token, human } = useAuth();
  const { subscribe } = useSSE();
  const [searchParams] = useSearchParams();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [chats, setChats] = useState<DirectChatSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const selectedAgent = useMemo(
    () => agents.find(a => a.id === selectedAgentId),
    [agents, selectedAgentId],
  );

  const loadChats = async () => {
    if (!token) return;
    const result = await get<{ chats: DirectChatSummary[] }>('/direct-chats', token);
    setChats(result.chats);
  };

  const loadMessages = async (agentId: string) => {
    if (!token || !agentId) return;
    setLoadingMessages(true);
    try {
      const result = await get<DirectMessagesResponse>(`/direct-chats/${agentId}/messages?limit=50`, token);
      setMessages([...result.messages].reverse());
      await loadChats();
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    get<{ agents: Agent[] }>('/agents', token)
      .then(r => setAgents(r.agents))
      .catch(() => {});
    loadChats().catch(() => {});
  }, [token]);

  useEffect(() => {
    const agentId = searchParams.get('agent');
    if (agentId) setSelectedAgentId(agentId);
  }, [searchParams]);

  useEffect(() => {
    if (!selectedAgentId) {
      setMessages([]);
      return;
    }
    loadMessages(selectedAgentId).catch(() => {});
  }, [selectedAgentId]);

  useEffect(() => {
    return subscribe(event => {
      if (event.event !== 'direct_message') return;
      const data = event.data as { from: string; to: string };
      loadChats().catch(() => {});
      if (data.from === selectedAgentId || data.to === selectedAgentId) {
        loadMessages(selectedAgentId).catch(() => {});
      }
    });
  }, [subscribe, selectedAgentId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!token || !selectedAgentId || !content.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      await post(`/direct-chats/${selectedAgentId}/messages`, token, {
        content: content.trim(),
        idempotency_key: crypto.randomUUID(),
      });
      setContent('');
      await loadMessages(selectedAgentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  };

  const sortedAgents = [...agents].sort((a, b) => {
    const aChat = chats.find(chat => chat.peer_id === a.id);
    const bChat = chats.find(chat => chat.peer_id === b.id);
    if (aChat && bChat) return bChat.updated_at.localeCompare(aChat.updated_at);
    if (aChat) return -1;
    if (bChat) return 1;
    return (a.display_name || a.name).localeCompare(b.display_name || b.name);
  });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader
        title="私信"
        eyebrow="Workspace"
        subtitle={`${agents.length} 个 Agent · ${chats.length} 条会话`}
        compact
      />

      <div className="flex-1 min-h-0 flex">
      <aside className="w-80 border-r border-border bg-surface flex flex-col">
        <header className="px-4 py-3 border-b border-border shrink-0">
          <h2 className="text-[12px] font-semibold text-text uppercase tracking-[0.12em]">Agent</h2>
        </header>

        <div className="flex-1 overflow-y-auto p-2">
          {sortedAgents.length === 0 ? (
            <EmptyState
              className="py-16"
              title="没有 Agent"
              description="创建 Agent 后，可以在这里打开 1:1 私信。"
            />
          ) : sortedAgents.map(a => {
            const chat = chats.find(c => c.peer_id === a.id);
            const name = a.display_name || a.name;
            return (
              <button
                key={a.id}
                onClick={() => setSelectedAgentId(a.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                  selectedAgentId === a.id
                    ? 'bg-accent-muted text-accent'
                    : 'text-text-muted hover:text-text hover:bg-surface-elevated'
                }`}
              >
                <AgentAvatar name={a.name} displayName={a.display_name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{name}</span>
                    <StatusIndicator status={a.status as 'active' | 'dormant' | 'recovering' | 'error'} />
                  </div>
                  {chat?.last_message && (
                    <p className="truncate text-xs text-text-muted mt-0.5">{chat.last_message.content}</p>
                  )}
                </div>
                {chat && chat.unread_count > 0 && (
                  <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-accent text-white text-[11px] flex items-center justify-center">
                    {chat.unread_count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </aside>

      <section className="flex-1 flex flex-col min-w-0">
        <header className="px-6 py-3 border-b border-border shrink-0 flex items-center gap-3 bg-surface min-h-[56px]">
          {selectedAgent ? (
            <>
              <AgentAvatar name={selectedAgent.name} displayName={selectedAgent.display_name} />
              <div className="min-w-0">
                <h2 className="text-base font-semibold truncate">{selectedAgent.display_name || selectedAgent.name}</h2>
                <div className="flex items-center gap-1.5 text-xs text-text-muted">
                  <StatusIndicator status={selectedAgent.status as 'active' | 'dormant' | 'recovering' | 'error'} />
                  <span>{selectedAgent.status}</span>
                </div>
              </div>
            </>
          ) : (
            <h2 className="text-base font-semibold">选择一个 Agent</h2>
          )}
        </header>

        <div className="flex-1 overflow-y-auto">
          {!selectedAgentId ? (
            <EmptyState className="h-full" title="选择一个 Agent" description="左侧列表按最近会话排序。选择 Agent 后即可发送私信。" />
          ) : loadingMessages ? (
            <div className="h-full flex items-center justify-center text-sm text-text-muted">加载中…</div>
          ) : messages.length === 0 ? (
            <EmptyState className="h-full" title="暂无私信" description="发送第一条消息后，对话会保留在这里。" />
          ) : (
            <div className="divide-y divide-border">
              {messages.map(msg => {
                const isMine = msg.from === human?.id;
                const sender = isMine
                  ? { name: human?.username, display_name: human?.display_name }
                  : selectedAgent;
                return (
                  <article key={msg.id} className="px-6 py-4 flex gap-3">
                    <AgentAvatar name={sender?.name || msg.from_name} displayName={sender?.display_name || msg.from_display_name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-text">
                          {sender?.display_name || sender?.name || msg.from_name || msg.from}
                        </span>
                        <span className="text-[11px] text-text-muted font-mono">
                          {new Date(msg.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-text mt-1 whitespace-pre-wrap break-words">{msg.content}</p>
                    </div>
                  </article>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="border-t border-border p-3 bg-surface">
          <div className="flex items-end gap-2 bg-surface-elevated rounded-xl px-3 py-2 border border-border focus-within:border-accent transition-colors">
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={!selectedAgentId}
              placeholder={selectedAgent ? `给 ${selectedAgent.display_name || selectedAgent.name} 发消息...` : '先选择一个 Agent'}
              rows={1}
              className="flex-1 bg-transparent text-sm text-text resize-none outline-none placeholder:text-text-muted min-h-[20px] max-h-[120px] disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!selectedAgentId || !content.trim() || sending}
              className="shrink-0 h-8 px-3 rounded-full bg-accent text-white text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              发送
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-error">{error}</p>}
        </div>
      </section>
      </div>
    </div>
  );
}
