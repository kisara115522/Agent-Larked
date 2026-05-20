import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSSE } from '../../context/SSEContext';
import { get } from '../../api/client';
import { StatusIndicator } from '../agent/StatusIndicator';
import { AgentAvatar } from '../agent/AgentAvatar';

type PanelTab = 'activity' | 'members' | 'tasks';

interface Agent { id: string; name: string; display_name: string; status: string; bio?: string; }
interface Room { id: string; name: string; member_count: number; }
interface Task { id: string; title: string; status: string; assigned_to?: string; priority: number; }

export function RightPanel() {
  const { token, human } = useAuth();
  const { subscribe, connected } = useSSE();
  const [tab, setTab] = useState<PanelTab>('activity');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (!token) return;
    get<{ agents: Agent[] }>('/agents', token).then(r => setAgents(r.agents)).catch(() => {});
    get<{ rooms: Room[] }>('/rooms', token).then(r => setRooms(r.rooms)).catch(() => {});
    get<{ tasks: Task[] }>('/tasks', token).then(r => setTasks(r.tasks)).catch(() => {});
  }, [token]);

  useEffect(() => {
    return subscribe(event => {
      if (event.event === 'agent_status') {
        const data = event.data as { agent_id: string; status: string };
        setAgents(prev => prev.map(a => a.id === data.agent_id ? { ...a, status: data.status } : a));
      }
    });
  }, [subscribe]);

  const activeCount = agents.filter(a => a.status === 'active').length;

  return (
    <aside className="bg-surface border-l border-border flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-border flex items-center gap-3 shrink-0">
        <h4 className="text-[13px] font-semibold flex-1">概览</h4>
        {activeCount > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-success-muted text-success">
            <span className="w-1 h-1 rounded-full bg-success status-dot-online" />
            {activeCount} 活跃
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border px-4 shrink-0">
        {([
          { key: 'activity' as const, label: '活动' },
          { key: 'members' as const, label: '成员' },
          { key: 'tasks' as const, label: '任务' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2.5 text-[12px] font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'text-accent border-accent' : 'text-text-muted border-transparent hover:text-text'
            }`}
          >
            {t.label}
            {t.key === 'tasks' && tasks.length > 0 && (
              <span className="ml-1 text-[10px] text-text-dim">{tasks.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'activity' && <ActivityTab agents={agents} rooms={rooms} connected={connected} />}
        {tab === 'members' && <MembersTab agents={agents} human={human} />}
        {tab === 'tasks' && <TasksTab tasks={tasks} agents={agents} />}
      </div>
    </aside>
  );
}

function ActivityTab({ agents, rooms, connected }: { agents: Agent[]; rooms: Room[]; connected: boolean }) {
  return (
    <div className="space-y-4">
      {/* Agent list */}
      <div>
        <SectionLabel>Agent 状态</SectionLabel>
        <div className="space-y-1">
          {agents.map(agent => (
            <div key={agent.id} className="flex items-center gap-2.5 py-2 px-2 -mx-2 rounded-[8px] hover:bg-surface-elevated/50 transition-colors">
              <AgentAvatar name={agent.name} displayName={agent.display_name} size="sm" />
              <div className="flex-1 min-w-0">
                <span className="text-[12px] font-medium truncate block">{agent.display_name || agent.name}</span>
                {agent.bio && <span className="text-[10px] text-text-dim truncate block">{agent.bio}</span>}
              </div>
              <StatusIndicator status={agent.status as 'active' | 'dormant' | 'recovering' | 'error'} />
            </div>
          ))}
          {agents.length === 0 && <EmptyState text="暂无 Agent" />}
        </div>
      </div>

      {/* Rooms */}
      {rooms.length > 0 && (
        <div>
          <SectionLabel>Room</SectionLabel>
          <div className="space-y-0.5">
            {rooms.map(room => (
              <div key={room.id} className="flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-[6px] hover:bg-surface-elevated/50 transition-colors">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-text-dim shrink-0">
                  <path d="M14 10a2 2 0 0 1-2 2H5l-3 2V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6z"/>
                </svg>
                <span className="flex-1 text-[12px] text-text-muted truncate">{room.name}</span>
                <span className="text-[10px] px-1.5 py-px rounded-full bg-surface-elevated text-text-dim border border-border font-mono">
                  {room.member_count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connection */}
      <div className="pt-2 border-t border-border">
        <div className="flex items-center gap-1.5 text-[11px] text-text-dim">
          <span
            className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-success status-dot-online' : 'bg-text-dim'}`}
          />
          SSE {connected ? '已连接' : '断开'}
        </div>
      </div>
    </div>
  );
}

function MembersTab({ agents, human }: { agents: Agent[]; human: { display_name?: string; username?: string } | null }) {
  return (
    <div className="space-y-0.5">
      {human && (
        <MemberRow
          name={human.display_name || human.username || 'Human'}
          avatarName={human.username || 'human'}
          badge="管理员"
        />
      )}
      {agents.map(agent => (
        <MemberRow
          key={agent.id}
          name={agent.display_name || agent.name}
          avatarName={agent.name}
          status={agent.status as 'active' | 'dormant' | 'recovering' | 'error'}
        />
      ))}
      {agents.length === 0 && !human && <EmptyState text="暂无成员" />}
    </div>
  );
}

function MemberRow({ name, avatarName, status, badge }: {
  name: string; avatarName: string; status?: 'active' | 'dormant' | 'recovering' | 'error'; badge?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 py-2 px-2 -mx-2 rounded-[8px] hover:bg-surface-elevated/50 transition-colors">
      <AgentAvatar name={avatarName} displayName={name} size="sm" />
      <span className="flex-1 text-[12px] font-medium truncate">{name}</span>
      {status && <StatusIndicator status={status} />}
      {badge && <span className="text-[10px] text-text-dim px-1.5 py-px rounded-full bg-surface-elevated border border-border">{badge}</span>}
    </div>
  );
}

function TasksTab({ tasks, agents }: { tasks: Task[]; agents: Agent[] }) {
  const statusConfig: Record<string, { label: string; cls: string }> = {
    todo: { label: '待办', cls: 'bg-surface-elevated text-text-dim border border-border' },
    in_progress: { label: '进行中', cls: 'bg-warning-muted text-warning' },
    review: { label: '审查', cls: 'bg-accent-muted text-accent' },
    done: { label: '完成', cls: 'bg-success-muted text-success' },
    rejected: { label: '退回', cls: 'bg-warning-muted text-warning' },
    error: { label: '错误', cls: 'bg-error-muted text-error' },
  };

  return (
    <div className="space-y-1">
      {tasks.map(task => {
        const assignee = task.assigned_to ? agents.find(a => a.id === task.assigned_to) : null;
        const cfg = statusConfig[task.status] || statusConfig.todo;
        return (
          <div key={task.id} className="py-2.5 px-2 -mx-2 rounded-[8px] hover:bg-surface-elevated/50 transition-colors">
            <div className="flex items-start gap-2">
              <span className={`shrink-0 mt-0.5 text-[10px] px-1.5 py-px rounded-full font-semibold ${cfg.cls}`}>
                {cfg.label}
              </span>
              <span className="text-[12px] font-medium leading-tight flex-1">{task.title}</span>
            </div>
            {assignee && (
              <div className="text-[11px] text-text-dim mt-1 ml-[calc(1.5rem+8px)]">
                {assignee.display_name || assignee.name}
              </div>
            )}
          </div>
        );
      })}
      {tasks.length === 0 && <EmptyState text="暂无任务" />}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-semibold text-text-dim uppercase tracking-widest mb-2 select-none">{children}</div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="text-center text-text-dim text-[12px] py-8">{text}</div>;
}
