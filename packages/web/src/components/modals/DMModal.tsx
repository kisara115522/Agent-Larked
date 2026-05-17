import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { post } from '../../api/client';

const AGENT_GRADIENTS: Record<string, string> = {
  claude001: '#10B981,#059669',
  claude002: '#F59E0B,#D97706',
  claude003: '#8B5CF6,#7C3AED',
  kisara: '#3B82F6,#8B5CF6',
};

function getGradient(name: string): string {
  return AGENT_GRADIENTS[name] || '#6B7280,#4B5563';
}

function getInitials(name: string): string {
  if (name === 'kisara') return 'K';
  const match = name.match(/claude(\d+)/);
  if (match) return `C${match[1]}`;
  return name.slice(0, 2).toUpperCase();
}

interface Message {
  id: string;
  from: string;
  text: string;
  time: string;
  isHuman: boolean;
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!token || !input.trim() || sending) return;
    const text = input.trim();
    setInput('');
    setSending(true);

    const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    setMessages(prev => [...prev, {
      id: `${Date.now()}`,
      from: human?.display_name || human?.username || 'kisara',
      text,
      time: now,
      isHuman: true,
    }]);

    try {
      await post(`/agents/${agentId}/dm`, token, { content: text });
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  };

  const gradient = getGradient(agentName);
  const initials = getInitials(agentName);

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
            <div className="text-xs text-text-muted">{agentBio || '无描述'}</div>
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
                {msg.isHuman ? 'K' : initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className={`text-[13px] font-semibold ${msg.isHuman ? 'text-accent' : ''}`}>{msg.from}</span>
                  <span className="text-[11px] text-text-dim font-mono">{msg.time}</span>
                </div>
                <div className="text-sm mt-0.5">{msg.text}</div>
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
