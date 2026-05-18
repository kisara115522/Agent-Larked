import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSSE } from '../../context/SSEContext';
import { get } from '../../api/client';
import { StatusIndicator } from '../agent/StatusIndicator';
import { AgentAvatar } from '../agent/AgentAvatar';

type PanelTab = 'activity' | 'members' | 'tasks';

interface Agent {
  id: string;
  name: string;
  display_name: string;
  status: string;
  bio?: string;
}

interface Room {
  id: string;
  name: string;
  member_count: number;
}

interface Task {
  id: string;
  title: string;
  status: string;
  assigned_to?: string;
  priority: number;
}

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
      <div className="p-4 border-b border-border flex items-center gap-3 shrink-0">
        <h4 className="text-sm font-semibold flex-1">实时活动</h4>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#064E3B] text-[#34D399]">
          {activeCount} 活跃
        </span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border px-4 shrink-0">
        {(['activity', 'members', 'tasks'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'text-accent border-accent' : 'text-text-muted border-transparent hover:text-text'
            }`}
          >
            {t === 'activity' ? '活动' : t === 'members' ? '成员' : '任务'}
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
    <div>
      {/* Agent statuses */}
      {agents.map(agent => (
        <div key={agent.id} className="mb-4">
          <div className="flex items-center gap-2 py-2 border-b border-border">
            <AgentAvatar name={agent.name} displayName={agent.display_name} size="sm" />
            <span className="text-[13px] font-medium flex-1">{agent.display_name || agent.name}</span>
            <StatusIndicator status={agent.status as 'active' | 'dormant' | 'recovering' | 'error'} />
          </div>
          <div className="text-[11px] text-text-dim py-1 font-mono">
            {agent.status === 'active' ? '运行中' : agent.status === 'recovering' ? '恢复中...' : agent.status === 'dormant' ? '休眠中' : agent.status === 'spawning' ? '启动中...' : agent.status}
            {agent.bio && <div className="text-text-muted mt-0.5">{agent.bio}</div>}
          </div>
        </div>
      ))}

      {/* Room status */}
      <h5 className="text-[11px] text-text-dim uppercase tracking-wider mt-4 mb-2">Room 状态</h5>
      {rooms.map(room => (
        <div key={room.id} className="flex items-center gap-1.5 py-1 text-xs text-text-muted">
          <span>💬</span>
          <span className="flex-1">{room.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-elevated text-text-dim border border-border">
            {room.member_count}
          </span>
        </div>
      ))}

      {/* Connection status */}
      <div className="mt-4 flex items-center gap-1.5 text-[11px] text-text-dim">
        <div className={`w-[5px] h-[5px] rounded-full ${connected ? 'bg-[#34D399]' : 'bg-text-dim'}`} />
        SSE {connected ? '已连接' : '断开'}
      </div>
    </div>
  );
}

function MembersTab({ agents, human }: { agents: Agent[]; human: { display_name?: string; username?: string } | null }) {
  return (
    <div>
      {/* Human user first */}
      {human && (
        <div className="flex items-center gap-2 py-2 border-b border-border">
          <AgentAvatar name={human.username || 'human'} displayName={human.display_name || human.username} size="sm" />
          <span className="flex-1 text-[13px]">{human.display_name || human.username}</span>
          <span className="text-[11px] text-text-muted">管理员</span>
        </div>
      )}
      {agents.map(agent => (
        <div key={agent.id} className="flex items-center gap-2 py-2 border-b border-border">
          <AgentAvatar name={agent.name} displayName={agent.display_name} size="sm" />
          <span className="flex-1 text-[13px]">{agent.display_name || agent.name}</span>
          <StatusIndicator status={agent.status as 'active' | 'dormant' | 'recovering' | 'error'} />
        </div>
      ))}
      {agents.length === 0 && !human && (
        <div className="text-center text-text-dim text-xs py-8">暂无成员</div>
      )}
    </div>
  );
}

function TasksTab({ tasks, agents }: { tasks: Task[]; agents: Agent[] }) {
  const statusLabel: Record<string, string> = {
    todo: '待办',
    in_progress: '进行中',
    review: '审查中',
    done: '完成',
    rejected: '退回',
    error: '错误',
  };
  const statusColor: Record<string, string> = {
    todo: 'bg-surface-elevated text-text-dim border border-border',
    in_progress: 'bg-[#78350F] text-[#FBBF24]',
    review: 'bg-accent-muted text-accent',
    done: 'bg-[#064E3B] text-[#34D399]',
    rejected: 'bg-[#78350F] text-[#FBBF24]',
    error: 'bg-error-muted text-error',
  };

  return (
    <div>
      {tasks.map(task => {
        const assignee = task.assigned_to ? agents.find(a => a.id === task.assigned_to) : null;
        return (
          <div key={task.id} className="py-2 border-b border-border">
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${statusColor[task.status] || statusColor.todo}`}>
                {statusLabel[task.status] || task.status}
              </span>
              <span className="text-xs font-medium">{task.title}</span>
            </div>
            {assignee && (
              <div className="text-text-dim text-[11px] mt-0.5">{assignee.display_name || assignee.name}</div>
            )}
          </div>
        );
      })}
      {tasks.length === 0 && (
        <div className="text-center text-text-dim text-xs py-8">暂无任务</div>
      )}
    </div>
  );
}
