import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { get } from '../api/client';
import { AgentAvatar } from '../components/agent/AgentAvatar';

interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  assigned_to?: string;
  priority: number;
  created_by: string;
  created_at: string;
}

interface Agent {
  id: string;
  name: string;
  display_name: string;
}

const STATUS_LABELS: Record<string, string> = {
  todo: '待办',
  in_progress: '进行中',
  review: '审查中',
  done: '完成',
  rejected: '退回',
  error: '错误',
};

const STATUS_BADGE: Record<string, string> = {
  todo: 'bg-surface-elevated text-text-muted border border-border',
  in_progress: 'bg-[#78350F] text-[#FBBF24]',
  review: 'bg-accent-muted text-accent',
  done: 'bg-[#064E3B] text-[#34D399]',
  rejected: 'bg-error-muted text-error',
  error: 'bg-error-muted text-error',
};

export function OrchestratorPage() {
  const { token } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [tasksRes, agentsRes] = await Promise.all([
        get<{ tasks: Task[] }>('/tasks', token).catch(() => ({ tasks: [] })),
        get<{ agents: Agent[] }>('/agents', token),
      ]);
      setTasks(tasksRes.tasks);
      setAgents(agentsRes.agents);
    } catch {}
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const getAgentName = (id: string) => agents.find(a => a.id === id)?.display_name || agents.find(a => a.id === id)?.name || id;

  const activeTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'rejected' && t.status !== 'error');

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-border flex items-center gap-3 shrink-0 bg-surface min-h-[56px]">
        <h3 className="text-base font-semibold">任务编排</h3>
        <div className="ml-auto text-xs text-text-muted">每个任务有自己的编排者 — 任何 agent 都可以是编排者</div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTasks.length === 0 ? (
          <div className="text-center text-text-dim text-sm py-16">
            暂无活跃任务。在任务看板创建任务后，编排链将在此显示。
          </div>
        ) : (
          <div className="max-w-[700px] space-y-4">
            {activeTasks.map(task => (
              <div key={task.id} className="bg-surface border border-border rounded-[10px] p-4 border-l-[3px] border-l-accent">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1">
                    <div className="text-[15px] font-semibold">{task.title}</div>
                    <div className="text-xs text-text-muted mt-0.5">{task.description || '无描述'}</div>
                  </div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_BADGE[task.status] || STATUS_BADGE.todo}`}>
                    {STATUS_LABELS[task.status] || task.status}
                  </span>
                </div>

                <div className="flex items-center gap-3 p-2 px-3 bg-bg rounded text-xs mb-3">
                  <span className="text-text-dim">编排者:</span>
                  <AgentAvatar name={getAgentName(task.created_by)} displayName={getAgentName(task.created_by)} size="sm" />
                  <span className="text-[13px] font-medium">{getAgentName(task.created_by)}</span>
                </div>

                <div className="flex flex-col gap-0">
                  <OrchStep
                    nodeType="human"
                    icon="👤"
                    title="任务创建"
                    desc={`${getAgentName(task.created_by)} 创建了任务`}
                  />
                  {task.assigned_to && (
                    <OrchStep
                      nodeType="worker"
                      icon="🤖"
                      title={`${getAgentName(task.assigned_to)} 执行中`}
                      desc={task.description || '正在处理...'}
                    />
                  )}
                </div>
              </div>
            ))}

            <div className="mt-8">
              <h4 className="text-sm font-semibold mb-4">编排原理</h4>
              <div className="grid grid-cols-2 gap-3">
                <InfoCard title="没有固定主 agent" desc="任何 agent 都可以是 Orchestrator。人类和谁对话，谁就是当前焦点。" />
                <InfoCard title="按任务分配编排者" desc="每个任务有自己的编排者。创建任务时可以指定任意 agent。" />
                <InfoCard title="Harness ≠ Orchestrator" desc="Harness = Server 内置模块（状态机）。Orchestrator = agent 角色（AI 驱动）。" />
                <InfoCard title="平等交流" desc="进入房间的 agent 都可以互相交流。协作是 peer-to-peer 的。" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OrchStep({ nodeType, icon, title, desc }: { nodeType: 'human' | 'orch' | 'worker' | 'result'; icon: string; title: string; desc: string }) {
  const borderMap = {
    human: 'border-accent bg-accent-muted',
    orch: 'border-[#FBBF24] bg-[#78350F]',
    worker: 'border-[#34D399] bg-[#064E3B]',
    result: 'border-text-dim bg-surface',
  };

  return (
    <div className="flex gap-4 relative">
      <div className="absolute left-[20px] top-[44px] bottom-[-16px] w-0.5 bg-border last:hidden" />
      <div className={`w-[42px] h-[42px] rounded-full flex items-center justify-center text-base shrink-0 border-2 z-10 ${borderMap[nodeType]}`}>
        {icon}
      </div>
      <div className="flex-1 pb-6">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-text-muted mt-0.5">{desc}</div>
      </div>
    </div>
  );
}

function InfoCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="bg-surface border border-border rounded-[10px] p-4">
      <div className="text-[13px] font-semibold mb-1.5">{title}</div>
      <div className="text-xs text-text-muted">{desc}</div>
    </div>
  );
}
