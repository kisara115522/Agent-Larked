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
import { EmptyState, ErrorState, Metric, MetricStrip, PageHeader, PageLoader, PageShell, Panel } from '../components/ui/PageState';

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
interface Runtime { id: string; host: string; port: number; agent_count: number; max_agents: number; status?: string; }

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
  const [loadError, setLoadError] = useState('');
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
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Agent 列表加载失败');
    } finally { setLoading(false); }
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
  const errorCount = agents.filter(a => a.status === 'error').length;
  const assignedCount = agents.filter(a => a.runtime_id).length;

  if (loading) {
    return <PageLoader label="加载 Agent" />;
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <PageHeader
        title="Agent"
        eyebrow="Workspace"
        subtitle={<><span className="text-success">{activeCount}</span> 运行中 · <span>{dormantCount}</span> 休眠</>}
        action={
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-semibold bg-accent text-white hover:bg-accent-hover transition-colors duration-150"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
            创建 Agent
          </button>
        }
      />

      <PageShell>
        {loadError && <div className="mb-4"><ErrorState message={loadError} onRetry={loadAgents} /></div>}
        <MetricStrip className="mb-5">
          <Metric label="总数" value={agents.length} detail={`${assignedCount} 已分配 Runtime`} tone="accent" />
          <Metric label="运行中" value={activeCount} detail={`${dormantCount} dormant`} tone={activeCount > 0 ? 'success' : 'muted'} />
          <Metric label="异常" value={errorCount} detail="需要唤醒或重新启动" tone={errorCount > 0 ? 'error' : 'muted'} />
          <Metric label="Runtime" value={runtimes.length} detail={`${runtimes.reduce((sum, runtime) => sum + runtime.max_agents, 0)} 总槽位`} tone="muted" />
        </MetricStrip>

        {agents.length === 0 ? (
          <EmptyState
            className="h-[420px]"
            title="还没有 Agent"
            description="创建一个 Agent 后，就可以把它分配到 Runtime、Room 和任务里。"
            action={
              <button
                onClick={() => setShowCreate(true)}
                className="px-4 py-2 rounded-full bg-accent text-white text-[12px] font-semibold hover:bg-accent-hover transition-colors"
              >
                创建 Agent
              </button>
            }
          />
        ) : (
          <Panel title="Agent 队列" meta={`${agents.length}`}>
            <div className="grid grid-cols-[minmax(220px,1.2fr)_120px_160px_minmax(180px,1fr)_220px] gap-3 px-4 py-2.5 border-b border-border bg-surface-elevated/60 text-[10px] text-text-dim uppercase tracking-[0.12em] font-semibold max-[1100px]:hidden">
              <span>Agent</span>
              <span>状态</span>
              <span>Runtime</span>
              <span>能力</span>
              <span>操作</span>
            </div>
            <div className="divide-y divide-border/70">
              {agents.map((agent, i) => (
                <AgentRow
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
          </Panel>
        )}
      </PageShell>

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
      {wakeAgent && <WakeSingleModal agentId={wakeAgent.id} agentName={wakeAgent.name} agentStatus={wakeAgent.status} lastActive={wakeAgent.last_active_at ? formatRelativeTime(wakeAgent.last_active_at) : undefined} rooms={rooms} runtimes={runtimes} onClose={() => setWakeAgent(null)} onWoken={loadAgents} />}
    </div>
  );
}

function AgentRow({ agent, index, onStop, onNavigate, onDM, onWakeModal, onSpawnModal }: {
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
      className="grid grid-cols-[minmax(220px,1.2fr)_120px_160px_minmax(180px,1fr)_220px] gap-3 px-4 py-3 cursor-pointer hover:bg-surface-elevated/45 transition-colors max-[1100px]:grid-cols-1 max-[1100px]:gap-3"
      style={{ animation: `fadeUp .35s ease-out ${index * 50}ms both` }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-10 h-10 rounded-[8px] flex items-center justify-center text-[12px] font-bold text-white shrink-0"
          style={{ background: `linear-gradient(135deg,${gradient})` }}
        >
          {initials}
        </div>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold truncate">{agent.display_name || agent.name}</div>
          <p className="text-[11px] text-text-muted mt-0.5 truncate">{agent.bio || agent.id.slice(0, 8)}</p>
        </div>
      </div>

      <div className="flex items-center">
        <StatusIndicator status={agent.status as 'active' | 'dormant' | 'recovering' | 'error'} />
        <span className="ml-2 text-[12px] text-text-muted">{agent.status}</span>
      </div>

      <div className="flex items-center text-[12px] text-text-muted font-mono">
        {agent.runtime_id ? agent.runtime_id.slice(0, 8) : '未分配'}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        {agent.capabilities.length > 0 ? (
          <>
            {agent.capabilities.slice(0, 3).map(cap => (
              <span key={cap} className="px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-surface-elevated/80 text-text-muted border border-border">
                {cap}
              </span>
            ))}
            {agent.capabilities.length > 3 && (
              <span className="px-2 py-0.5 text-[10px] text-text-dim">+{agent.capabilities.length - 3}</span>
            )}
          </>
        ) : (
          <span className="text-[11px] text-text-dim">无能力标签</span>
        )}
      </div>

      <div className="flex items-center justify-end gap-1.5 max-[1100px]:justify-start">
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
