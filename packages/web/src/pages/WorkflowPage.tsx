import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { get } from '../api/client';
import { SpawnModal } from '../components/modals/SpawnModal';

interface Agent {
  id: string;
  name: string;
  display_name: string;
  status: string;
  bio?: string;
}

interface Task {
  id: string;
  title: string;
  status: string;
  assigned_to?: string;
  priority: number;
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

interface WorkflowEvent {
  id: string;
  type: 'tool' | 'msg' | 'think' | 'system' | 'error';
  agent: string;
  agentDisplay: string;
  action: string;
  detail: string;
  time: string;
  tokenUsage?: string;
}

const AGENT_COLORS: Record<string, string> = {
  claude001: '#10B981',
  claude002: '#F59E0B',
  claude003: '#8B5CF6',
  kisara: '#3B82F6',
};

function getAgentColor(name: string): string {
  return AGENT_COLORS[name] || '#6B7280';
}

export function WorkflowPage() {
  const { token } = useAuth();
  const { subscribe } = useSSE();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
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
        get<{ rooms: Room[] }>('/rooms', token).catch(() => ({ rooms: [] })),
        get<{ runtimes: Runtime[] }>('/runtimes', token).catch(() => ({ runtimes: [] })),
        get<{ events: Array<{ id: string; agent_id: string; agent_name?: string; event_type: string; detail?: string; created_at: string }> }>('/activity', token).catch(() => ({ events: [] })),
        get<{ usage: Array<{ agent_id: string; input_tokens: number; output_tokens: number }> }>('/token-usage', token).catch(() => ({ usage: [] })),
      ]);
      setAgents(agentsRes.agents);
      setTasks(tasksRes.tasks);
      setRooms(roomsRes.rooms);
      setRuntimes(runtimesRes.runtimes);
      // Convert activity log to workflow events
      const converted: WorkflowEvent[] = activityRes.events.slice(0, 30).map(ev => ({
        id: ev.id,
        type: ev.event_type === 'tool_call' ? 'tool' : ev.event_type === 'message' ? 'msg' : ev.event_type === 'think' ? 'think' : ev.event_type === 'error' ? 'error' : 'system',
        agent: ev.agent_name || ev.agent_id,
        agentDisplay: ev.agent_name || ev.agent_id.slice(0, 8),
        action: ev.event_type,
        detail: ev.detail || '',
        time: new Date(ev.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      }));
      if (converted.length > 0) setEvents(prev => [...converted, ...prev].slice(0, 50));
      // Sum today's token usage
      const totalTokens = usageRes.usage.reduce((sum, u) => sum + u.input_tokens + u.output_tokens, 0);
      setTodayTokens(totalTokens);
    } catch {}
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Generate workflow events from SSE
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
        const data = event.data as { agent_id: string; agent_name?: string; event_type: string; detail?: string };
        setEvents(prev => [{
          id: `${Date.now()}-${Math.random()}`,
          type: (data.event_type === 'tool_call' ? 'tool' : data.event_type === 'message' ? 'msg' : data.event_type === 'think' ? 'think' : data.event_type === 'error' ? 'error' : 'system') as WorkflowEvent['type'],
          agent: data.agent_name || data.agent_id,
          agentDisplay: data.agent_name || data.agent_id.slice(0, 8),
          action: data.event_type,
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
  const reviewTasks = tasks.filter(t => t.status === 'review').length;
  const totalAgents = agents.length;
  const activeRuntimes = runtimes.filter(r => r.agent_count > 0).length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-border flex items-center gap-3 shrink-0 bg-surface min-h-[56px]">
        <h3 className="text-base font-semibold">Agent 工作流</h3>
        <div className="ml-auto flex items-center gap-3 text-xs text-text-muted">
          <span>实时更新</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#064E3B] text-[#34D399]">
            {activeCount} 个 agent 活跃中
          </span>
          <button onClick={() => setShowSpawn(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold bg-accent text-white hover:bg-accent-hover transition-colors">
            + 启动 Agent
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 p-5">
          <StatCard label="在线 Agent" value={String(activeCount)} sub={`共 ${totalAgents} 个 Profile`} color="text-[#34D399]" />
          <StatCard label="活跃 Runtime" value={activeRuntimes > 0 ? String(activeRuntimes) : '-'} sub={activeRuntimes > 0 ? `${activeRuntimes} 台机器` : '等待 Runtime daemon'} color="text-accent" />
          <StatCard label="进行中任务" value={String(inProgressTasks)} sub={`待办 ${todoTasks} / 审查 ${reviewTasks}`} color="text-[#FBBF24]" />
          <StatCard label="今日 Token" value={todayTokens > 0 ? todayTokens.toLocaleString() : '-'} sub={todayTokens > 0 ? '输入 + 输出' : '暂无使用记录'} />
        </div>

        {/* Live Workflow Timeline */}
        <div className="px-6 py-4">
          <h4 className="text-[11px] text-text-muted uppercase tracking-wider mb-3">实时执行流</h4>
          {events.length === 0 ? (
            <div className="text-center text-text-dim text-sm py-12">
              等待事件... 发送消息或 agent 状态变更将在此显示
            </div>
          ) : (
            <div className="space-y-2">
              {events.map(ev => (
                <WorkflowItem key={ev.id} event={ev} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Spawn Modal */}
      {showSpawn && (
        <SpawnModal
          agents={agents}
          runtimes={runtimes}
          rooms={rooms}
          onClose={() => setShowSpawn(false)}
          onSpawned={load}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="bg-surface border border-border rounded-[10px] p-4">
      <div className="text-[11px] text-text-muted uppercase tracking-wider">{label}</div>
      <div className={`text-[28px] font-bold tracking-tight mt-0.5 ${color || 'text-text'}`}>{value}</div>
      <div className="text-xs text-text-muted mt-0.5">{sub}</div>
    </div>
  );
}

function WorkflowItem({ event }: { event: WorkflowEvent }) {
  const iconMap = {
    tool: { icon: '🔧', cls: 'border-accent bg-accent-muted' },
    msg: { icon: '💬', cls: 'border-[#34D399] bg-[#064E3B]' },
    think: { icon: '💭', cls: 'border-[#FBBF24] bg-[#78350F]' },
    system: { icon: '⚡', cls: 'border-text-dim bg-surface' },
    error: { icon: '❌', cls: 'border-error bg-error-muted' },
  };
  const { icon, cls } = iconMap[event.type] || iconMap.system;

  return (
    <div className="flex gap-3 py-2 relative">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 border-2 z-10 ${cls}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold" style={{ color: getAgentColor(event.agent) }}>
            {event.agentDisplay}
          </span>
          <span className="text-xs text-text-muted">{event.action}</span>
          <span className="text-[11px] text-text-dim font-mono ml-auto">{event.time}</span>
        </div>
        {event.detail && (
          <div className="mt-1 text-xs text-text-muted leading-relaxed">{event.detail}</div>
        )}
        {event.tokenUsage && (
          <div className="text-[11px] text-text-dim font-mono mt-0.5">{event.tokenUsage}</div>
        )}
      </div>
    </div>
  );
}
