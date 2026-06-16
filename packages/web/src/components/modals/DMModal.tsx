import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSSE } from '../../context/SSEContext';
import { get, post } from '../../api/client';
import { useToast } from '../ui/Toast';
import { getAgentGradient, getAgentInitials } from '../../utils/agent-style';
import { useAgentActivity } from '../../hooks/useAgentActivity';
import { AgentActivityTrace } from '../activity/AgentActivityTrace';
import type { AgentActivity } from '../../types/activity';

interface Message {
  id: string;
  from: string;
  text: string;
  time: string;
  isHuman: boolean;
}

interface DmApiMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  created_at: string;
  sequence: number;
}

export function DMModal({ agentId, agentName, agentBio, onClose }: {
  agentId: string;
  agentName: string;
  agentBio?: string;
  onClose: () => void;
}) {
  const { token, human } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string>('dormant');
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadHistory = useCallback(async () => {
    if (!token) return;
    try {
      const res = await get<{ messages: DmApiMessage[] }>(`/direct-chats/${agentId}/messages`, token).catch(() => ({ messages: [] }));
      const humanId = human?.id;
      const loaded: Message[] = res.messages.map(m => ({
        id: m.id,
        from: m.from === humanId ? (human?.display_name || human?.username || 'Human') : agentName,
        text: m.content,
        time: new Date(m.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        isHuman: m.from === humanId,
      }));
      setMessages(loaded);
    } catch {}
  }, [token, agentId, agentName, human]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Subscribe to real-time DM updates via SSE
  const { subscribe } = useSSE();
  useEffect(() => {
    return subscribe((sseEvent) => {
      if (sseEvent.event !== 'direct_message') return;
      const data = sseEvent.data as { message_id: string; from: string; to: string; content: string; sequence: number };
      // Only handle DMs for this conversation
      if (data.from !== agentId && data.to !== agentId) return;

      const humanId = human?.id;
      const isFromHuman = data.from === humanId;

      setMessages(prev => {
        // Deduplicate: skip if we already have this message_id
        if (prev.some(m => m.id === data.message_id)) return prev;

        // For human's own messages: skip if we already have an optimistic entry
        // (the optimistic entry uses a timestamp id; the SSE echo has the real id)
        if (isFromHuman) {
          const hasOptimistic = prev.some(m =>
            m.isHuman && m.text === data.content && m.id.startsWith('1'),
          );
          if (hasOptimistic) return prev;
        }

        return [...prev, {
          id: data.message_id,
          from: isFromHuman ? (human?.display_name || human?.username || 'Human') : agentName,
          text: data.content,
          time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          isHuman: isFromHuman,
        }];
      });
    });
  }, [subscribe, agentId, agentName, human]);

  // Subscribe to agent status changes for live status indicator
  useEffect(() => {
    return subscribe((sseEvent) => {
      if (sseEvent.event !== 'agent_status') return;
      const data = sseEvent.data as { agent_id: string; status: string };
      if (data.agent_id === agentId) {
        setAgentStatus(data.status);
      }
    });
  }, [subscribe, agentId]);

  const handleSend = async () => {
    if (!token || !input.trim() || sending) return;
    const text = input.trim();
    setInput('');
    setSending(true);

    const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    setMessages(prev => [...prev, {
      id: `${Date.now()}`,
      from: human?.display_name || human?.username || 'Human',
      text,
      time: now,
      isHuman: true,
    }]);

    try {
      await post(`/direct-chats/${agentId}/messages`, token, { content: text });
    } catch (e) {
      toast(`发送失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setSending(false);
    }
  };

  const gradient = getAgentGradient(agentName);
  const initials = getAgentInitials(agentName);

  // Agent activity timeline (think/tool_call chain)
  const { activities } = useAgentActivity(agentId);

  // Group activities into turns aligned with agent messages.
  // Each "turn" = activities between the previous human message and this agent message.
  const activitiesByMessageId = useMemo(() => {
    if (activities.length === 0 || messages.length === 0) return new Map<string, AgentActivity[]>();
    const map = new Map<string, AgentActivity[]>();
    const humanTimestamps = messages
      .filter(m => m.isHuman)
      .map(m => new Date(m.time).getTime());

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.isHuman) continue;

      // Find the previous human message timestamp
      const msgTime = new Date(msg.time).getTime();
      const prevHumanTime = humanTimestamps.filter(t => t < msgTime).pop() ?? 0;

      // Collect activities between prevHumanTime and msgTime (inclusive of nearby)
      const turnActivities = activities.filter(a => {
        const aTime = new Date(a.created_at).getTime();
        return aTime >= prevHumanTime && aTime <= msgTime + 5000; // +5s tolerance
      });

      if (turnActivities.length > 0) {
        map.set(msg.id, turnActivities);
      }
    }
    return map;
  }, [messages, activities]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="w-[480px] h-[600px] bg-surface border border-border rounded-[14px] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0" style={{ background: `linear-gradient(135deg,${gradient})` }}>
            {initials}
          </div>
          <div>
            <div className="text-[15px] font-semibold">{agentName}</div>
            <div className="text-xs text-text-muted flex items-center gap-1.5">
              {agentBio || '无描述'}
              {agentStatus === 'spawning' && (
                <span className="inline-flex items-center gap-1 text-amber-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  启动中…
                </span>
              )}
              {agentStatus === 'active' && (
                <span className="inline-flex items-center gap-1 text-green-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  工作中
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="ml-auto text-text-muted hover:text-text text-xl">×</button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          <div className="text-center text-text-dim text-[11px] py-2">
            与 {agentName} 的私密对话 · DM 消息在下一个 tool boundary 注入
          </div>
          {messages.map(msg => (
            <div key={msg.id} className="flex gap-2.5">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: `linear-gradient(135deg,${msg.isHuman ? '#3B82F6,#8B5CF6' : gradient})` }}>
                {msg.isHuman ? (human?.display_name?.[0] || human?.username?.[0] || 'H').toUpperCase() : initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className={`text-[13px] font-semibold ${msg.isHuman ? 'text-accent' : ''}`}>{msg.from}</span>
                  <span className="text-[11px] text-text-dim font-mono">{msg.time}</span>
                </div>
                <div className="text-sm mt-0.5">{msg.text}</div>
                {!msg.isHuman && activitiesByMessageId.has(msg.id) && (
                  <AgentActivityTrace
                    activities={activitiesByMessageId.get(msg.id)!}
                    className="mt-1"
                  />
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-border flex gap-2 shrink-0">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="输入消息..."
            className="flex-1 px-3 py-2.5 bg-surface border border-border rounded-[14px] text-sm text-text placeholder:text-text-dim focus:border-accent"
          />
          <button onClick={handleSend} disabled={sending || !input.trim()} className="px-4 py-2 text-sm font-semibold bg-accent text-white rounded-full hover:bg-accent-hover disabled:opacity-50">
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
