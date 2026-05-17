import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { get, post } from '../api/client';
import { AgentAvatar } from '../components/agent/AgentAvatar';
import { WakeSingleModal } from '../components/modals/WakeSingleModal';

interface Agent {
  id: string;
  name: string;
  display_name: string;
  status: string;
  last_active_at: string | null;
}

interface Room {
  id: string;
  name: string;
}

export function WakePage() {
  const { token } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState('');
  const [wakeAgent, setWakeAgent] = useState<Agent | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [agentsRes, roomsRes] = await Promise.all([
        get<{ agents: Agent[] }>('/agents', token),
        get<{ rooms: Room[] }>('/rooms', token).catch(() => ({ rooms: [] })),
      ]);
      setAgents(agentsRes.agents);
      setRooms(roomsRes.rooms);
      if (roomsRes.rooms.length > 0 && !selectedRoom) setSelectedRoom(roomsRes.rooms[0].id);
    } catch {}
  }, [token, selectedRoom]);

  useEffect(() => { load(); }, [load]);

  const dormantAgents = agents.filter(a => a.status === 'dormant' || a.status === 'error');

  const handleBroadcastWake = async () => {
    if (!token || !selectedRoom) return;
    try {
      await post(`/rooms/${selectedRoom}/broadcast-wake`, token, {});
      load();
    } catch {}
  };

  const handleQuickWake = async (agentId: string) => {
    if (!token) return;
    try {
      await post(`/agents/${agentId}/wake`, token, {});
      load();
    } catch {}
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-border flex items-center gap-3 shrink-0 bg-surface min-h-[56px]">
        <h3 className="text-base font-semibold">唤醒控制</h3>
        <div className="ml-auto text-xs text-text-muted">三种唤醒方式: 人类启动 / @mention / Broadcast</div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Manual Wake */}
        <h4 className="text-sm font-semibold mb-3">手动唤醒</h4>
        {dormantAgents.length === 0 ? (
          <div className="text-center text-text-dim text-sm py-6 bg-surface border border-border rounded-[10px]">
            所有 agent 都已活跃，无需唤醒
          </div>
        ) : (
          dormantAgents.map(agent => (
            <div key={agent.id} className="bg-surface border border-border rounded-[10px] p-4 mb-3 flex items-center gap-3">
              <AgentAvatar name={agent.name} displayName={agent.display_name} size="lg" />
              <div className="flex-1">
                <div className="text-sm font-semibold">{agent.display_name || agent.name}</div>
                <div className="text-xs text-text-muted mt-0.5">
                  {agent.status} · {agent.last_active_at ? `${formatRelativeTime(agent.last_active_at)}未活跃` : '从未活跃'} · 最后 Session: 无
                </div>
              </div>
              <button onClick={() => setWakeAgent(agent)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#064E3B] text-[#34D399] hover:bg-[#34D399] hover:text-white transition-colors">
                🔔 唤醒
              </button>
              <button onClick={() => handleQuickWake(agent.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-accent text-white hover:bg-accent-hover transition-colors">
                启动到 Runtime
              </button>
            </div>
          ))
        )}

        {/* Broadcast Wake */}
        <h4 className="text-sm font-semibold mt-6 mb-3">Broadcast 唤醒</h4>
        <div className="bg-surface border border-border rounded-[10px] p-4 flex items-center gap-4">
          <div className="flex-1">
            <div className="text-sm font-semibold">唤醒 Room 内所有 dormant agent</div>
            <div className="text-xs text-text-muted mt-0.5">向 Room 内所有处于 dormant 状态的 agent 发送唤醒 callback</div>
          </div>
          <select value={selectedRoom} onChange={e => setSelectedRoom(e.target.value)} className="px-3 py-2 bg-surface border border-border rounded-[14px] text-sm text-text w-[200px]">
            {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            {rooms.length === 0 && <option>选择 Room...</option>}
          </select>
          <button onClick={handleBroadcastWake} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#064E3B] text-[#34D399] hover:bg-[#34D399] hover:text-white transition-colors">
            🔔 全部唤醒
          </button>
        </div>

        {/* Wake History */}
        <h4 className="text-sm font-semibold mt-6 mb-3">唤醒历史</h4>
        <div className="text-xs text-text-muted">
          <div className="py-1.5 border-b border-border flex gap-3">
            <span className="font-mono text-text-dim w-[60px]">--:--</span>
            <span>暂无唤醒记录</span>
          </div>
        </div>
      </div>

      {/* Wake Single Modal */}
      {wakeAgent && (
        <WakeSingleModal
          agentId={wakeAgent.id}
          agentName={wakeAgent.name}
          agentStatus={wakeAgent.status}
          lastActive={wakeAgent.last_active_at ? formatRelativeTime(wakeAgent.last_active_at) : undefined}
          rooms={rooms}
          onClose={() => setWakeAgent(null)}
          onWoken={load}
        />
      )}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
