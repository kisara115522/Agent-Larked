import { useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { get } from '../api/client';
import { SpawnModal } from '../components/modals/SpawnModal';
import { EmptyState, ErrorState, PageHeader } from '../components/ui/PageState';

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
  const [loadError, setLoadError] = useState('');

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
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '工作流数据加载失败');
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    return subscribe(event => {
      if (event.event === 'room_message' || event.event === 'direct_message') {
        const data = event.data as { from?: string; from_agent?: string; from_name?: string; content?: string };
        const from = data.from_agent || data.from;
        setEvents(prev => [{
          id: `${Date.now()}-${Math.random()}`,
          type: 'msg' as const,
          agent: data.from_name || from || 'unknown',
          agentDisplay: data.from_name || from || 'unknown',
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
  const dormantCount = agents.filter(a => a.status === 'dormant').length;
  const errorCount = agents.filter(a => a.status === 'error').length;
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;
  const todoTasks = tasks.filter(t => t.status === 'todo').length;
  const reviewTasks = tasks.filter(t => t.status === 'review').length;
  const totalAgents = agents.length;
  const onlineRuntimes = runtimes.length;
  const runtimeUsed = runtimes.reduce((sum, runtime) => sum + runtime.agent_count, 0);
  const runtimeCapacity = runtimes.reduce((sum, runtime) => sum + runtime.max_agents, 0);
  const openTasks = tasks.filter(t => !['done', 'rejected', 'error'].includes(t.status));
  const recentAgents = agents.slice(0, 6);
  const focusTasks = openTasks.slice(0, 5);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="工作流"
        subtitle={`${onlineRuntimes} 个 Runtime · ${openTasks.length} 个未完成任务 · ${events.length} 条近期事件`}
        action={
          <button
            onClick={() => setShowSpawn(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-semibold bg-accent text-white hover:bg-accent-hover transition-colors duration-150"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
            启动 Agent
          </button>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-10 py-6">
        {loadError && <div className="mb-4"><ErrorState message={loadError} onRetry={load} /></div>}

        <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-5 max-[1200px]:grid-cols-1">
          <div className="min-w-0 space-y-5">
            <section className="bg-surface border border-border rounded-[10px] overflow-hidden">
              <div className="grid grid-cols-4 divide-x divide-border max-[900px]:grid-cols-2 max-[900px]:divide-x-0">
                <MetricTile
                  label="Agent 在线"
                  value={`${activeCount}/${totalAgents || 0}`}
                  detail={`${dormantCount} dormant · ${errorCount} error`}
                  tone={activeCount > 0 ? 'success' : 'muted'}
                />
                <MetricTile
                  label="Runtime 槽位"
                  value={`${runtimeUsed}/${runtimeCapacity || 0}`}
                  detail={onlineRuntimes > 0 ? `${onlineRuntimes} 台运行时在线` : '等待 Runtime 连接'}
                  tone="accent"
                />
                <MetricTile
                  label="任务推进"
                  value={inProgressTasks + reviewTasks}
                  detail={`${todoTasks} 待办 · ${reviewTasks} 审查`}
                  tone={inProgressTasks + reviewTasks > 0 ? 'warning' : 'muted'}
                />
                <MetricTile
                  label="今日 Token"
                  value={todayTokens > 0 ? formatNumber(todayTokens) : '—'}
                  detail={todayTokens > 0 ? 'input + output' : '暂无消耗'}
                  tone="muted"
                />
              </div>
            </section>

            <DashboardPanel
              title="实时执行流"
              meta={`${events.length} events`}
              action={activeCount > 0 && (
                <span className="inline-flex items-center gap-2 text-[11px] text-success font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-success status-dot-online" />
                  live
                </span>
              )}
            >
              {events.length === 0 ? (
                <EmptyTimeline onStart={() => setShowSpawn(true)} />
              ) : (
                <div>
                  <div className="grid grid-cols-[84px_140px_104px_minmax(0,1fr)] gap-3 px-4 py-2.5 border-b border-border bg-surface-elevated/60 text-[10px] text-text-dim uppercase tracking-[0.12em] font-semibold max-[820px]:hidden">
                    <span>时间</span>
                    <span>Agent</span>
                    <span>类型</span>
                    <span>事件</span>
                  </div>
                  <div className="divide-y divide-border/70">
                    {events.map((ev, i) => (
                      <TimelineRow key={ev.id} event={ev} index={i} />
                    ))}
                  </div>
                </div>
              )}
            </DashboardPanel>
          </div>

          <aside className="space-y-4 min-w-0">
            <DashboardPanel title="运行概览" meta="system">
              <div className="p-4 space-y-4">
                <OverviewMeter
                  label="Agent 活跃率"
                  value={`${activeCount}/${totalAgents || 0}`}
                  percent={totalAgents > 0 ? activeCount / totalAgents : 0}
                />
                <OverviewMeter
                  label="Runtime 占用"
                  value={`${runtimeUsed}/${runtimeCapacity || 0}`}
                  percent={runtimeCapacity > 0 ? runtimeUsed / runtimeCapacity : 0}
                />
                <OverviewMeter
                  label="任务推进"
                  value={`${inProgressTasks + reviewTasks}/${openTasks.length || 0}`}
                  percent={openTasks.length > 0 ? (inProgressTasks + reviewTasks) / openTasks.length : 0}
                />
              </div>
            </DashboardPanel>

            <DashboardPanel title="Agent 队列" meta={`${agents.length}`}>
              {recentAgents.length === 0 ? (
                <CompactEmpty text="还没有 Agent Profile" />
              ) : (
                <div className="p-2">
                  {recentAgents.map(agent => (
                    <AgentQueueItem key={agent.id} agent={agent} />
                  ))}
                </div>
              )}
            </DashboardPanel>

            <DashboardPanel title="任务焦点" meta={`${openTasks.length}`}>
              {focusTasks.length === 0 ? (
                <CompactEmpty text="当前没有未完成任务" />
              ) : (
                <div className="p-2 space-y-1">
                  {focusTasks.map(task => (
                    <TaskFocusItem key={task.id} task={task} agents={agents} />
                  ))}
                </div>
              )}
            </DashboardPanel>

            <DashboardPanel title="Runtime" meta={`${onlineRuntimes}`}>
              {runtimes.length === 0 ? (
                <CompactEmpty text="等待 Runtime 上线" />
              ) : (
                <div className="p-2 space-y-1">
                  {runtimes.slice(0, 4).map(runtime => (
                    <RuntimeItem key={runtime.id} runtime={runtime} />
                  ))}
                </div>
              )}
            </DashboardPanel>
          </aside>
        </div>
      </div>

      {showSpawn && <SpawnModal agents={agents} runtimes={runtimes} rooms={rooms} onClose={() => setShowSpawn(false)} onSpawned={load} />}
    </div>
  );
}

type Tone = 'accent' | 'success' | 'warning' | 'muted';

const TONE_CLASS: Record<Tone, string> = {
  accent: 'text-accent bg-accent-soft',
  success: 'text-success bg-success-muted',
  warning: 'text-warning bg-warning-muted',
  muted: 'text-text-muted bg-surface-elevated',
};

function MetricTile({ label, value, detail, tone }: {
  label: string; value: number | string; detail: string; tone: Tone;
}) {
  return (
    <div className="min-h-[118px] px-5 py-4 flex flex-col justify-between">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold text-text-dim uppercase tracking-[0.12em]">{label}</span>
        <span className={`w-2 h-2 rounded-full ${TONE_CLASS[tone]}`} />
      </div>
      <div>
        <div className="text-[28px] leading-none font-bold tabular-nums">{value}</div>
        <p className="mt-2 text-[11px] text-text-muted leading-snug">{detail}</p>
      </div>
    </div>
  );
}

function DashboardPanel({ title, meta, action, children }: {
  title: string; meta?: string; action?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="bg-surface border border-border rounded-[10px] overflow-hidden">
      <div className="h-12 px-4 border-b border-border flex items-center gap-3">
        <h2 className="text-[12px] font-semibold text-text uppercase tracking-[0.12em]">{title}</h2>
        {meta && <span className="text-[10px] text-text-dim font-mono px-2 py-0.5 rounded-full bg-surface-elevated">{meta}</span>}
        <div className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  );
}

const PALETTE = ['#3b82f6', '#34d399', '#fbbf24', '#14b8a6', '#f97316', '#06b6d4', '#ef4444'];
function getAgentColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

const EVENT_TYPE_STYLE: Record<WorkflowEvent['type'], { dot: string; badge: string; label: string }> = {
  tool: { dot: 'bg-accent', badge: 'bg-accent-soft text-accent', label: '工具' },
  msg: { dot: 'bg-success', badge: 'bg-success-muted text-success', label: '消息' },
  think: { dot: 'bg-warning', badge: 'bg-warning-muted text-warning', label: '思考' },
  system: { dot: 'bg-text-dim', badge: 'bg-surface-elevated text-text-muted', label: '系统' },
  error: { dot: 'bg-error', badge: 'bg-error-muted text-error', label: '错误' },
};

function TimelineRow({ event, index }: { event: WorkflowEvent; index: number }) {
  const style = EVENT_TYPE_STYLE[event.type] || EVENT_TYPE_STYLE.system;

  return (
    <div
      className="grid grid-cols-[84px_140px_104px_minmax(0,1fr)] gap-3 px-4 py-3 hover:bg-surface-elevated/45 transition-colors max-[820px]:grid-cols-[80px_minmax(0,1fr)]"
      style={index < 8 ? { animation: `fadeUp .3s ease-out ${index * 40}ms both` } : undefined}
    >
      <span className="text-[11px] text-text-dim font-mono tabular-nums pt-0.5">{event.time}</span>
      <div className="min-w-0 flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
        <span className="text-[13px] font-semibold truncate" style={{ color: getAgentColor(event.agent) }}>
          {event.agentDisplay}
        </span>
      </div>
      <div className="max-[820px]:hidden">
        <span className={`inline-flex items-center px-2 py-1 rounded-full text-[10px] font-semibold ${style.badge}`}>
          {style.label}
        </span>
      </div>
      <div className="min-w-0 max-[820px]:col-span-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[12px] text-text-muted font-semibold shrink-0">{event.action}</span>
          {event.detail && <span className="text-[12px] text-text leading-relaxed truncate">{event.detail}</span>}
        </div>
      </div>
    </div>
  );
}

function OverviewMeter({ label, value, percent }: { label: string; value: string; percent: number }) {
  const width = `${Math.max(0, Math.min(percent, 1)) * 100}%`;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-[12px] text-text-muted font-medium">{label}</span>
        <span className="text-[11px] text-text-dim font-mono">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-surface-elevated overflow-hidden">
        <div className="h-full rounded-full bg-accent" style={{ width }} />
      </div>
    </div>
  );
}

function AgentQueueItem({ agent }: { agent: Agent }) {
  return (
    <div className="flex items-center gap-3 px-2 py-2.5 rounded-[8px] hover:bg-surface-elevated/60 transition-colors">
      <div className="w-7 h-7 rounded-full bg-surface-elevated border border-border flex items-center justify-center text-[11px] font-bold" style={{ color: getAgentColor(agent.id) }}>
        {(agent.display_name || agent.name || '?').slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold truncate">{agent.display_name || agent.name}</div>
        <div className="text-[10px] text-text-dim truncate">{agent.bio || agent.id.slice(0, 8)}</div>
      </div>
      <StatusBadge status={agent.status} />
    </div>
  );
}

function TaskFocusItem({ task, agents }: { task: Task; agents: Agent[] }) {
  const assignee = task.assigned_to ? agents.find(agent => agent.id === task.assigned_to) : undefined;
  return (
    <div className="px-3 py-2.5 rounded-[8px] hover:bg-surface-elevated/60 transition-colors">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-semibold truncate flex-1">{task.title}</span>
        <TaskStatusBadge status={task.status} />
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-text-dim">
        <span>优先级 {task.priority}</span>
        {assignee && <span className="truncate">· {assignee.display_name || assignee.name}</span>}
      </div>
    </div>
  );
}

function RuntimeItem({ runtime }: { runtime: Runtime }) {
  const percent = runtime.max_agents > 0 ? runtime.agent_count / runtime.max_agents : 0;
  return (
    <div className="px-3 py-2.5 rounded-[8px] hover:bg-surface-elevated/60 transition-colors">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-success status-dot-online" />
        <span className="text-[12px] font-semibold truncate flex-1">{runtime.host}:{runtime.port}</span>
        <span className="text-[10px] text-text-dim font-mono">{runtime.agent_count}/{runtime.max_agents}</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-surface-elevated overflow-hidden">
        <div className="h-full rounded-full bg-success" style={{ width: `${Math.max(0, Math.min(percent, 1)) * 100}%` }} />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const statusMap: Record<string, { label: string; cls: string }> = {
    active: { label: 'active', cls: 'bg-success-muted text-success' },
    dormant: { label: 'dormant', cls: 'bg-surface-elevated text-text-muted' },
    spawning: { label: 'spawning', cls: 'bg-accent-soft text-accent' },
    recovering: { label: 'recovering', cls: 'bg-warning-muted text-warning' },
    error: { label: 'error', cls: 'bg-error-muted text-error' },
  };
  const item = statusMap[status] || { label: status, cls: 'bg-surface-elevated text-text-muted' };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${item.cls}`}>{item.label}</span>;
}

function TaskStatusBadge({ status }: { status: string }) {
  const statusMap: Record<string, { label: string; cls: string }> = {
    todo: { label: '待办', cls: 'bg-surface-elevated text-text-muted' },
    in_progress: { label: '进行中', cls: 'bg-warning-muted text-warning' },
    review: { label: '审查', cls: 'bg-accent-soft text-accent' },
  };
  const item = statusMap[status] || { label: status, cls: 'bg-surface-elevated text-text-muted' };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${item.cls}`}>{item.label}</span>;
}

function CompactEmpty({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-[12px] text-text-dim">{text}</div>;
}

function EmptyTimeline({ onStart }: { onStart: () => void }) {
  return (
    <EmptyState
      className="py-16"
      title="还没有执行事件"
      description="启动一个 Agent 或等待新的 Room 消息后，这里会按时间顺序显示工具调用、消息和状态变化。"
      action={
        <button
          onClick={onStart}
          className="px-4 py-2 rounded-full bg-accent text-white text-[12px] font-semibold hover:bg-accent-hover transition-colors"
        >
          启动 Agent
        </button>
      }
    />
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
