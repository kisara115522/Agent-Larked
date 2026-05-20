import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { get } from '../api/client';
import { SpawnModal } from '../components/modals/SpawnModal';

interface Agent { id: string; name: string; display_name: string; status: string; bio?: string; }
interface Task { id: string; title: string; status: string; assigned_to?: string; priority: number; }
interface Runtime { id: string; host: string; port: number; agent_count: number; max_agents: number; }

interface WorkflowEvent {
  id: string;
  type: 'tool' | 'msg' | 'think' | 'system' | 'error';
  agent: string;
  agentDisplay: string;
  action: string;
  detail: string;
  time: string;
}

export function WorkflowPage() {
  const { token } = useAuth();
  const { subscribe } = useSSE();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [rooms, setRooms] = useState<Array<{ id: string; name: string }>>([]);
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [showSpawn, setShowSpawn] = useState(false);
  const [todayTokens, setTodayTokens] = useState(0);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [agentsRes, tasksRes, roomsRes, runtimesRes, activityRes, usageRes] = await Promise.all([
        get<{ agents: Agent[] }>('/agents', token),
        get<{ tasks: Task[] }>('/tasks', token).catch(() => ({ tasks: [] })),
        get<{ rooms: Array<{ id: string; name: string }> }>('/rooms', token).catch(() => ({ rooms: [] })),
        get<{ runtimes: Runtime[] }>('/runtimes', token).catch(() => ({ runtimes: [] })),
        get<{ logs: Array<{ id: string; agent_id: string; agent_name?: string; activity_type: string; detail?: string; created_at: string }> }>('/activity', token).catch(() => ({ logs: [] })),
        get<{ usage: Array<{ agent_id: string; input_tokens: number; output_tokens: number }> }>('/token-usage', token).catch(() => ({ usage: [] })),
      ]);
      setAgents(agentsRes.agents);
      setTasks(tasksRes.tasks);
      setRooms(roomsRes.rooms);
      setRuntimes(runtimesRes.runtimes);
      const converted: WorkflowEvent[] = activityRes.logs.slice(0, 30).map(ev => ({
        id: ev.id,
        type: ev.activity_type === 'tool_call' ? 'tool' : ev.activity_type === 'message' ? 'msg' : ev.activity_type === 'think' ? 'think' : ev.activity_type === 'error' ? 'error' : 'system',
        agent: ev.agent_name || ev.agent_id,
        agentDisplay: ev.agent_name || ev.agent_id.slice(0, 8),
        action: ev.activity_type,
        detail: ev.detail || '',
        time: new Date(ev.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      }));
      if (converted.length > 0) setEvents(prev => [...converted, ...prev].slice(0, 50));
      const totalTokens = usageRes.usage.reduce((sum, u) => sum + u.input_tokens + u.output_tokens, 0);
      setTodayTokens(totalTokens);
    } catch {}
  }, [token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    return subscribe(event => {
      if (event.event === 'room_message' || event.event === 'direct_message') {
        const data = event.data as { from_agent?: string; from_name?: string; content?: string };
        setEvents(prev => [{
          id: `${Date.now()}-${Math.random()}`,
          type: 'msg' as const,
          agent: data.from_name || data.from_agent || 'unknown',
          agentDisplay: data.from_name || data.from_agent || 'unknown',
          action: '发送消息',
          detail: data.content?.slice(0, 120) || '',
          time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        }, ...prev].slice(0, 50));
      }
      if (event.event === 'workflow_event') {
        const data = event.data as { agent_id: string; agent_name?: string; activity_type: string; detail?: string };
        setEvents(prev => [{
          id: `${Date.now()}-${Math.random()}`,
          type: (data.activity_type === 'tool_call' ? 'tool' : data.activity_type === 'message' ? 'msg' : data.activity_type === 'think' ? 'think' : data.activity_type === 'error' ? 'error' : 'system') as WorkflowEvent['type'],
          agent: data.agent_name || data.agent_id,
          agentDisplay: data.agent_name || data.agent_id.slice(0, 8),
          action: data.activity_type,
          detail: data.detail || '',
          time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        }, ...prev].slice(0, 50));
      }
      if (event.event === 'agent_status') {
        const data = event.data as { agent_id: string; status: string; name?: string };
        setAgents(prev => prev.map(a => a.id === data.agent_id ? { ...a, status: data.status } : a));
        setEvents(prev => [{
          id: `${Date.now()}-${Math.random()}`,
          type: 'system' as const,
          agent: data.name || data.agent_id,
          agentDisplay: data.name || data.agent_id,
          action: '状态变更',
          detail: `→ ${data.status}`,
          time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        }, ...prev].slice(0, 50));
      }
    });
  }, [subscribe]);

  const activeCount = agents.filter(a => a.status === 'active').length;
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;
  const todoTasks = tasks.filter(t => t.status === 'todo').length;
  const totalAgents = agents.length;
  const onlineRuntimes = runtimes.length;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Hero section with massive breathing room */}
      <div className="px-12 pt-16 pb-8" style={{ animation: 'fadeUp .4s ease-out' }}>
        <div className="flex items-end justify-between mb-2">
          <div>
            <h1 className="text-[36px] font-black tracking-tight leading-none" style={{ fontFamily: 'var(--font-display)' }}>
              工作流
            </h1>
            <p className="text-[14px] text-text-dim mt-3 font-medium">
              {activeCount > 0
                ? `${activeCount} 个 Agent 正在运行`
                : '所有 Agent 处于休眠状态'}
            </p>
          </div>
          <button
            onClick={() => setShowSpawn(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-semibold bg-accent text-white hover:bg-accent-hover transition-colors duration-150"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
            启动 Agent
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="px-12 pb-10">
        <div className="grid grid-cols-4 gap-4">
          <GlassStatCard
            label="在线 Agent"
            value={activeCount}
            total={totalAgents}
            color="#34d399"
            delay={0}
          />
          <GlassStatCard
            label="Runtime"
            value={onlineRuntimes}
            sub={onlineRuntimes > 0 ? `${runtimes.reduce((s, r) => s + r.agent_count, 0)} 槽位` : '等待连接'}
            color="#3b82f6"
            delay={50}
          />
          <GlassStatCard
            label="进行中"
            value={inProgressTasks}
            sub={`待办 ${todoTasks}`}
            color="#fbbf24"
            delay={100}
          />
          <GlassStatCard
            label="今日 Token"
            value={todayTokens > 0 ? formatNumber(todayTokens) : '—'}
            sub={todayTokens > 0 ? 'input + output' : '暂无'}
            color="#f0f0f5"
            delay={150}
          />
        </div>
      </div>

      {/* Timeline */}
      <div className="px-12 pb-12 flex-1">
        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-[13px] font-semibold text-text-muted uppercase tracking-[0.15em]">实时执行流</h2>
          {events.length > 0 && (
            <span className="text-[11px] text-text-dim font-mono px-2 py-0.5 rounded-full bg-surface-elevated">{events.length}</span>
          )}
          <div className="flex-1" />
          {activeCount > 0 && (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success status-dot-online" />
              <span className="text-[11px] text-success font-medium">运行中</span>
            </div>
          )}
        </div>

        {events.length === 0 ? (
          <EmptyTimeline />
        ) : (
          <div className="space-y-2">
            {events.map((ev, i) => (
              <TimelineRow key={ev.id} event={ev} index={i} />
            ))}
          </div>
        )}
      </div>

      {showSpawn && <SpawnModal agents={agents} runtimes={runtimes} rooms={rooms} onClose={() => setShowSpawn(false)} onSpawned={load} />}
    </div>
  );
}

function GlassStatCard({ label, value, total, sub, color, delay }: {
  label: string; value: number | string; total?: number; sub?: string; color: string; delay: number;
}) {
  return (
    <div
      className="bg-surface border border-border rounded-[10px] p-6 group"
      style={{ animation: `fadeUp .4s ease-out ${delay}ms both` }}
    >
      <div className="text-[11px] font-semibold text-text-dim uppercase tracking-[0.12em] mb-4">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-[32px] font-black tracking-tight leading-none" style={{ color }}>
          {value}
        </span>
        {total !== undefined && (
          <span className="text-[13px] text-text-dim font-mono">/ {total}</span>
        )}
      </div>
      {sub && <p className="text-[11px] text-text-dim mt-3 font-medium">{sub}</p>}
    </div>
  );
}

// PLACEHOLDER_TIMELINE_COMPONENTS

const PALETTE = ['#3b82f6', '#34d399', '#f59e0b', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4', '#ef4444', '#a855f7'];
function getAgentColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function TimelineRow({ event, index }: { event: WorkflowEvent; index: number }) {
  const typeStyles: Record<string, { dot: string; label: string }> = {
    tool: { dot: 'bg-accent', label: '工具' },
    msg: { dot: 'bg-success', label: '消息' },
    think: { dot: 'bg-warning', label: '思考' },
    system: { dot: 'bg-text-dim', label: '系统' },
    error: { dot: 'bg-error', label: '错误' },
  };
  const style = typeStyles[event.type] || typeStyles.system;

  return (
    <div
      className="flex items-start gap-4 px-4 py-3 rounded-[12px] hover:bg-surface-elevated/50 transition-all duration-200 group"
      style={index < 8 ? { animation: `fadeUp .3s ease-out ${index * 40}ms both` } : undefined}
    >
      {/* Dot */}
      <div className="pt-1.5 shrink-0">
        <div className={`w-2 h-2 rounded-full ${style.dot}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold" style={{ color: getAgentColor(event.agent) }}>
            {event.agentDisplay}
          </span>
          <span className="text-[11px] text-text-dim font-medium">{event.action}</span>
        </div>
        {event.detail && (
          <p className="mt-1 text-[12px] text-text-muted leading-relaxed line-clamp-2">{event.detail}</p>
        )}
      </div>

      {/* Time */}
      <span className="text-[11px] text-text-dim font-mono tabular-nums shrink-0 pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {event.time}
      </span>
    </div>
  );
}

function EmptyTimeline() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center" style={{ animation: 'fadeUp .5s ease-out' }}>
      {/* Orbital animation */}
      <div className="relative w-32 h-32 mb-8">
        <div className="absolute inset-0 rounded-full border border-border" />
        <div className="absolute inset-4 rounded-full border border-border/50" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-4 h-4 rounded-full bg-accent/20 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-accent" />
          </div>
        </div>
      </div>
      <p className="text-[14px] text-text-muted font-medium">等待事件</p>
      <p className="text-[12px] text-text-dim mt-2 max-w-[240px]">启动 Agent 后，活动将在此实时显示</p>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
