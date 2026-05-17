import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { get, post } from '../api/client';
import { StatusIndicator } from '../components/agent/StatusIndicator';
import { SpawnModal } from '../components/modals/SpawnModal';
import { DMModal } from '../components/modals/DMModal';
import { WakeSingleModal } from '../components/modals/WakeSingleModal';

interface Agent {
  id: string;
  name: string;
  display_name: string;
  bio: string;
  capabilities: string[];
  status: string;
  runtime_id?: string;
  last_active_at?: string;
}

interface Room {
  id: string;
  name: string;
  visibility: string;
  member_count: number;
}

interface Runtime {
  id: string;
  host: string;
  port: number;
  agent_count: number;
  max_agents: number;
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-[#064E3B] text-[#34D399]',
  dormant: 'bg-surface-elevated text-text-muted border border-border',
  recovering: 'bg-[#78350F] text-[#FBBF24]',
  error: 'bg-error-muted text-error',
};

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

export function AgentListPage() {
  const { token } = useAuth();
  const { subscribe } = useSSE();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBio, setNewBio] = useState('');
  const [newCapabilities, setNewCapabilities] = useState('');
  const [creating, setCreating] = useState(false);
  const [spawnAgent, setSpawnAgent] = useState<Agent | null>(null);
  const [dmAgent, setDmAgent] = useState<Agent | null>(null);
  const [wakeAgent, setWakeAgent] = useState<Agent | null>(null);

  const loadAgents = useCallback(async () => {
    if (!token) return;
    try {
      const [agentsRes, roomsRes, runtimesRes] = await Promise.all([
        get<{ agents: Agent[] }>('/agents', token),
        get<{ rooms: Room[] }>('/rooms', token).catch(() => ({ rooms: [] })),
        get<{ runtimes: Runtime[] }>('/runtimes', token).catch(() => ({ runtimes: [] })),
      ]);
      setAgents(agentsRes.agents);
      setRooms(roomsRes.rooms);
      setRuntimes(runtimesRes.runtimes);
    } catch {} finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  useEffect(() => {
    return subscribe(event => {
      if (event.event === 'agent_status') {
        const data = event.data as { agent_id: string; status: string };
        setAgents(prev => prev.map(a => a.id === data.agent_id ? { ...a, status: data.status } : a));
      }
    });
  }, [subscribe]);

  const handleStop = async (agentId: string) => {
    if (!token) return;
    try { await post(`/agents/${agentId}/stop`, token); loadAgents(); } catch {}
  };
  const handleCreate = async () => {
    if (!token || !newName.trim()) return;
    setCreating(true);
    try {
      await post('/agents', token, {
        name: newName.trim(),
        bio: newBio.trim() || undefined,
        capabilities: newCapabilities.trim() ? newCapabilities.split(',').map(s => s.trim()) : [],
      });
      setShowCreate(false); setNewName(''); setNewBio(''); setNewCapabilities('');
      loadAgents();
    } catch {} finally { setCreating(false); }
  };

  if (loading) {
    return <div className="h-full flex items-center justify-center"><p className="text-sm text-text-muted">加载中...</p></div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-border flex items-center gap-3 shrink-0 bg-surface min-h-[56px]">
        <h3 className="text-base font-semibold">Agent 管理</h3>
        <div className="ml-auto">
          <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[13px] font-semibold bg-accent text-white hover:bg-accent-hover transition-colors">
            + 启动新 Agent
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-3">
          {agents.map(agent => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onStop={handleStop}
              onNavigate={() => navigate(`/agents/${agent.id}`)}
              onDM={() => setDmAgent(agent)}
              onWakeModal={() => setWakeAgent(agent)}
              onSpawnModal={() => setSpawnAgent(agent)}
            />
          ))}
          {agents.length === 0 && (
            <div className="text-center text-text-dim text-sm py-16">暂无 agent，点击上方按钮创建</div>
          )}
        </div>
      </div>

      {/* Create Agent Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="w-[520px] p-6 bg-surface border border-border rounded-[14px]" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">创建 Agent</h3>
            <div className="mb-4">
              <label className="block text-xs text-text-muted mb-1">Agent 名称</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="agent-name" className="w-full px-3 py-2.5 bg-surface border border-border rounded-[14px] text-sm text-text placeholder:text-text-dim focus:border-accent" />
            </div>
            <div className="mb-4">
              <label className="block text-xs text-text-muted mb-1">Bio</label>
              <input value={newBio} onChange={e => setNewBio(e.target.value)} placeholder="描述这个 agent 的用途" className="w-full px-3 py-2.5 bg-surface border border-border rounded-[14px] text-sm text-text placeholder:text-text-dim focus:border-accent" />
            </div>
            <div className="mb-4">
              <label className="block text-xs text-text-muted mb-1">Capabilities（逗号分隔）</label>
              <input value={newCapabilities} onChange={e => setNewCapabilities(e.target.value)} placeholder="code-analysis, security, ..." className="w-full px-3 py-2.5 bg-surface border border-border rounded-[14px] text-sm text-text placeholder:text-text-dim focus:border-accent" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-text-muted hover:text-text">取消</button>
              <button onClick={handleCreate} disabled={creating || !newName.trim()} className="px-4 py-2 text-sm font-semibold bg-accent text-white rounded-full hover:bg-accent-hover disabled:opacity-50">
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spawn Modal */}
      {spawnAgent && (
        <SpawnModal
          agents={agents}
          runtimes={runtimes}
          rooms={rooms}
          onClose={() => setSpawnAgent(null)}
          onSpawned={loadAgents}
        />
      )}

      {/* DM Modal */}
      {dmAgent && (
        <DMModal
          agentId={dmAgent.id}
          agentName={dmAgent.name}
          agentBio={dmAgent.bio}
          onClose={() => setDmAgent(null)}
        />
      )}

      {/* Wake Single Modal */}
      {wakeAgent && (
        <WakeSingleModal
          agentId={wakeAgent.id}
          agentName={wakeAgent.name}
          agentStatus={wakeAgent.status}
          lastActive={wakeAgent.last_active_at ? formatRelativeTime(wakeAgent.last_active_at) : undefined}
          rooms={rooms}
          onClose={() => setWakeAgent(null)}
          onWoken={loadAgents}
        />
      )}
    </div>
  );
}

function AgentCard({ agent, onStop, onNavigate, onDM, onWakeModal, onSpawnModal }: {
  agent: Agent;
  onStop: (id: string) => void;
  onNavigate: () => void;
  onDM: () => void;
  onWakeModal: () => void;
  onSpawnModal: () => void;
}) {
  const isDormant = agent.status === 'dormant';
  const gradient = getGradient(agent.name);
  const initials = getInitials(agent.name);

  return (
    <div
      onClick={onNavigate}
      className={`bg-surface border border-border rounded-[10px] p-4 transition-border-color hover:border-text-dim cursor-pointer ${isDormant ? 'opacity-70' : ''}`}
    >
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-full flex items-center justify-center text-base font-bold text-white shrink-0" style={{ background: `linear-gradient(135deg,${gradient})` }}>
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold">{agent.display_name || agent.name}</span>
            <StatusIndicator status={agent.status as 'active' | 'dormant' | 'recovering' | 'error'} />
          </div>
          <div className="text-xs text-text-muted">{agent.bio || '无描述'}</div>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_BADGE[agent.status] || STATUS_BADGE.dormant}`}>
          {agent.status}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-3 mt-3 text-xs">
        <div><div className="text-text-dim mb-0.5">Runtime</div><div className="text-text-muted">{agent.runtime_id ? '已分配' : '未分配'}</div></div>
        <div><div className="text-text-dim mb-0.5">Session</div><div className="text-text-muted font-mono text-[11px]">—</div></div>
        <div><div className="text-text-dim mb-0.5">最后活跃</div><div className="text-text-muted">{agent.last_active_at ? formatRelativeTime(agent.last_active_at) : '从未'}</div></div>
        <div><div className="text-text-dim mb-0.5">Token</div><div className="text-text-muted">—</div></div>
      </div>

      <div className="flex gap-2 mt-3 pt-3 border-t border-border">
        <button onClick={e => { e.stopPropagation(); onDM(); }} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-accent text-white hover:bg-accent-hover">对话</button>
        <button onClick={e => { e.stopPropagation(); onNavigate(); }} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-elevated text-text border border-border hover:border-text-dim">详情</button>
        {agent.status === 'active' && (
          <button onClick={e => { e.stopPropagation(); onStop(agent.id); }} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-error-muted text-error hover:bg-error hover:text-white ml-auto">停止</button>
        )}
        {(agent.status === 'dormant' || agent.status === 'error') && (
          <>
            <button onClick={e => { e.stopPropagation(); onWakeModal(); }} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#064E3B] text-[#34D399] hover:bg-[#34D399] hover:text-white ml-auto">唤醒</button>
            <button onClick={e => { e.stopPropagation(); onSpawnModal(); }} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-accent text-white hover:bg-accent-hover">启动</button>
          </>
        )}
      </div>
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
