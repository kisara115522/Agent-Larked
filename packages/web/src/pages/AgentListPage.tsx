import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { get, post } from '../api/client';
import { useToast } from '../components/ui/Toast';
import { StatusIndicator } from '../components/agent/StatusIndicator';
import { SpawnModal } from '../components/modals/SpawnModal';
import { DMModal } from '../components/modals/DMModal';
import { WakeSingleModal } from '../components/modals/WakeSingleModal';
import { getAgentGradient, getAgentInitials } from '../utils/agent-style';

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

interface Room { id: string; name: string; visibility: string; member_count: number; }
interface Runtime { id: string; host: string; port: number; agent_count: number; max_agents: number; }

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
  const { toast } = useToast();

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
    } catch {} finally { setLoading(false); }
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
    try { await post(`/agents/${agentId}/stop`, token); toast('Agent 已停止', 'success'); loadAgents(); }
    catch (e) { toast(`停止失败: ${e instanceof Error ? e.message : '未知错误'}`); }
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
      toast('Agent 创建成功', 'success');
      setShowCreate(false); setNewName(''); setNewBio(''); setNewCapabilities('');
      loadAgents();
    } catch (e) { toast(`创建失败: ${e instanceof Error ? e.message : '未知错误'}`); }
    finally { setCreating(false); }
  };

  const activeCount = agents.filter(a => a.status === 'active').length;
  const dormantCount = agents.filter(a => a.status === 'dormant').length;

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
          <p className="text-sm text-text-dim font-medium">加载 Agent</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-12 pt-16 pb-8" style={{ animation: 'fadeUp .4s ease-out' }}>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[36px] font-black tracking-tight leading-none" style={{ fontFamily: 'var(--font-display)' }}>
              Agent
            </h1>
            <p className="text-[14px] text-text-dim mt-3 font-medium">
              <span className="text-success">{activeCount}</span> 运行中 · <span>{dormantCount}</span> 休眠
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-semibold bg-accent text-white hover:bg-accent-hover transition-colors duration-150"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
            创建 Agent
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="px-12 pb-12 flex-1">
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[400px] text-center">
            <div className="relative w-24 h-24 mb-6">
              <div className="absolute inset-0 rounded-full border border-border" />
              <div className="absolute inset-3 rounded-full border border-border/50" />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-dim">
                  <circle cx="12" cy="8" r="5"/><path d="M3 21c0-4.97 4.03-9 9-9s9 4.03 9 9"/>
                </svg>
              </div>
            </div>
            <p className="text-[14px] text-text-muted font-medium mb-1">暂无 Agent</p>
            <p className="text-[12px] text-text-dim">创建你的第一个 AI agent 开始协作</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
            {agents.map((agent, i) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                index={i}
                onStop={handleStop}
                onNavigate={() => navigate(`/agents/${agent.id}`)}
                onDM={() => setDmAgent(agent)}
                onWakeModal={() => setWakeAgent(agent)}
                onSpawnModal={() => setSpawnAgent(agent)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}>
          <h3 className="text-[18px] font-bold mb-6" style={{ fontFamily: 'var(--font-display)' }}>创建 Agent</h3>
          <Field label="名称" hint="唯一标识符，如 code-reviewer">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="agent-name" className="input" autoFocus />
          </Field>
          <Field label="Bio" hint="描述这个 agent 的职责">
            <input value={newBio} onChange={e => setNewBio(e.target.value)} placeholder="负责代码审查和安全分析" className="input" />
          </Field>
          <Field label="Capabilities" hint="逗号分隔的能力标签">
            <input value={newCapabilities} onChange={e => setNewCapabilities(e.target.value)} placeholder="code-analysis, security, testing" className="input" />
          </Field>
          <div className="flex gap-3 justify-end mt-8">
            <button onClick={() => setShowCreate(false)} className="px-5 py-2.5 text-[13px] text-text-muted hover:text-text rounded-full transition-colors">取消</button>
            <button onClick={handleCreate} disabled={creating || !newName.trim()} className="px-6 py-2.5 text-[13px] font-semibold bg-accent text-white rounded-full hover:bg-accent-hover disabled:opacity-30 transition-all active:scale-95">
              {creating ? '创建中...' : '创建'}
            </button>
          </div>
        </Modal>
      )}

      {spawnAgent && <SpawnModal agents={agents} runtimes={runtimes} rooms={rooms} onClose={() => setSpawnAgent(null)} onSpawned={loadAgents} />}
      {dmAgent && <DMModal agentId={dmAgent.id} agentName={dmAgent.name} agentBio={dmAgent.bio} onClose={() => setDmAgent(null)} />}
      {wakeAgent && <WakeSingleModal agentId={wakeAgent.id} agentName={wakeAgent.name} agentStatus={wakeAgent.status} lastActive={wakeAgent.last_active_at ? formatRelativeTime(wakeAgent.last_active_at) : undefined} rooms={rooms} onClose={() => setWakeAgent(null)} onWoken={loadAgents} />}
    </div>
  );
}

// PLACEHOLDER_AGENT_CARD

function AgentCard({ agent, index, onStop, onNavigate, onDM, onWakeModal, onSpawnModal }: {
  agent: Agent; index: number;
  onStop: (id: string) => void; onNavigate: () => void;
  onDM: () => void; onWakeModal: () => void; onSpawnModal: () => void;
}) {
  const isActive = agent.status === 'active';
  const isDormant = agent.status === 'dormant';
  const gradient = getAgentGradient(agent.name);
  const initials = getAgentInitials(agent.name);

  return (
    <div
      onClick={onNavigate}
      className="bg-surface border border-border rounded-[10px] p-5 cursor-pointer group hover:border-accent/40 transition-colors duration-150"
      style={{ animation: `fadeUp .35s ease-out ${index * 50}ms both` }}
    >
      <div className="flex items-start gap-4">
        <div
          className="w-12 h-12 rounded-[12px] flex items-center justify-center text-[14px] font-bold text-white shrink-0 transition-transform duration-300 group-hover:scale-105"
          style={{ background: `linear-gradient(135deg,${gradient})` }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="text-[15px] font-semibold truncate">{agent.display_name || agent.name}</span>
            <StatusIndicator status={agent.status as 'active' | 'dormant' | 'recovering' | 'error'} />
          </div>
          <p className="text-[12px] text-text-muted mt-1 line-clamp-1">{agent.bio || '无描述'}</p>
        </div>
      </div>

      {agent.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-4">
          {agent.capabilities.slice(0, 3).map(cap => (
            <span key={cap} className="px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-surface-elevated/80 text-text-muted border border-border">
              {cap}
            </span>
          ))}
          {agent.capabilities.length > 3 && (
            <span className="px-2 py-0.5 text-[10px] text-text-dim">+{agent.capabilities.length - 3}</span>
          )}
        </div>
      )}

      <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border/50 text-[11px] text-text-dim">
        <span className="font-mono">{agent.runtime_id ? '⚡ Runtime' : '— 未分配'}</span>
        <span>{agent.last_active_at ? formatRelativeTime(agent.last_active_at) : '从未活跃'}</span>
        <div className="ml-auto flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <ActionPill onClick={e => { e.stopPropagation(); onDM(); }} color="accent">对话</ActionPill>
          {isActive && <ActionPill onClick={e => { e.stopPropagation(); onStop(agent.id); }} color="error">停止</ActionPill>}
          {(isDormant || agent.status === 'error') && (
            <>
              <ActionPill onClick={e => { e.stopPropagation(); onWakeModal(); }} color="success">唤醒</ActionPill>
              <ActionPill onClick={e => { e.stopPropagation(); onSpawnModal(); }} color="accent">启动</ActionPill>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionPill({ onClick, color, children }: { onClick: (e: React.MouseEvent) => void; color: string; children: React.ReactNode }) {
  const colorMap: Record<string, string> = {
    accent: 'bg-accent-muted text-accent hover:bg-accent hover:text-white',
    error: 'bg-error-muted text-error hover:bg-error hover:text-white',
    success: 'bg-success-muted text-success hover:bg-success hover:text-white',
  };
  return (
    <button onClick={onClick} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all duration-200 ${colorMap[color]}`}>
      {children}
    </button>
  );
}

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose} style={{ animation: 'fadeIn .15s ease-out' }}>
      <div className="w-[460px] p-7 bg-surface-elevated border border-border rounded-[14px] shadow-lg" onClick={e => e.stopPropagation()} style={{ animation: 'scaleIn .2s ease-out' }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-[12px] font-semibold text-text-muted mb-2">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-text-dim mt-1.5">{hint}</p>}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
