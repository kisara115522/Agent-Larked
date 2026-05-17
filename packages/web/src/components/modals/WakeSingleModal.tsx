import { useState } from 'react';
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

interface Room {
  id: string;
  name: string;
}

export function WakeSingleModal({ agentId, agentName, agentStatus, lastActive, rooms, onClose, onWoken }: {
  agentId: string;
  agentName: string;
  agentStatus: string;
  lastActive?: string;
  rooms: Room[];
  onClose: () => void;
  onWoken: () => void;
}) {
  const { token } = useAuth();
  const [prompt, setPrompt] = useState('');
  const [selectedRoom, setSelectedRoom] = useState(rooms[0]?.id || '');
  const [waking, setWaking] = useState(false);

  const handleWake = async () => {
    if (!token) return;
    setWaking(true);
    try {
      await post(`/agents/${agentId}/wake`, token, {
        prompt: prompt.trim() || undefined,
        room_id: selectedRoom || undefined,
      });
      onWoken();
      onClose();
    } catch {
      // ignore
    } finally {
      setWaking(false);
    }
  };

  const gradient = getGradient(agentName);
  const initials = getInitials(agentName);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="w-[400px] p-6 bg-surface border border-border rounded-[14px]" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">唤醒 Agent</h3>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-full flex items-center justify-center text-base font-bold text-white shrink-0" style={{ background: `linear-gradient(135deg,${gradient})` }}>
            {initials}
          </div>
          <div>
            <div className="text-base font-semibold">{agentName}</div>
            <div className="text-xs text-text-muted">{agentStatus} · {lastActive || '从未活跃'}</div>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-text-muted mb-1">唤醒 Prompt（可选）</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="给 agent 的唤醒指令..."
            rows={3}
            className="w-full px-3 py-2.5 bg-surface border border-border rounded-[14px] text-sm text-text placeholder:text-text-dim focus:border-accent resize-none"
          />
        </div>

        <div className="mb-4">
          <label className="block text-xs text-text-muted mb-1">目标 Room</label>
          <select value={selectedRoom} onChange={e => setSelectedRoom(e.target.value)} className="w-full px-3 py-2.5 bg-surface border border-border rounded-[14px] text-sm text-text focus:border-accent">
            {rooms.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-muted hover:text-text">取消</button>
          <button onClick={handleWake} disabled={waking} className="px-4 py-2 text-sm font-semibold bg-[#064E3B] text-[#34D399] rounded-full hover:bg-[#34D399] hover:text-white disabled:opacity-50">
            {waking ? '唤醒中...' : '🔔 唤醒'}
          </button>
        </div>
      </div>
    </div>
  );
}
