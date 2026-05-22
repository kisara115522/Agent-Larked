import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { get } from '../api/client';
import { AgentAvatar } from '../components/agent/AgentAvatar';
import { EmptyState, ErrorState, Metric, MetricStrip, PageHeader, PageShell, Panel } from '../components/ui/PageState';

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
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [tasksRes, agentsRes] = await Promise.all([
        get<{ tasks: Task[] }>('/tasks', token).catch(() => ({ tasks: [] })),
        get<{ agents: Agent[] }>('/agents', token),
      ]);
      setTasks(tasksRes.tasks);
      setAgents(agentsRes.agents);
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '编排数据加载失败');
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const getAgentName = (id: string) => agents.find(a => a.id === id)?.display_name || agents.find(a => a.id === id)?.name || id;

  const activeTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'rejected' && t.status !== 'error');
  const assignedTasks = activeTasks.filter(t => t.assigned_to);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="任务编排"
        eyebrow="Operations"
        subtitle="每个任务有自己的编排者，当前焦点由任务和对话决定。"
      />

      <PageShell>
        {loadError && <div className="mb-4"><ErrorState message={loadError} onRetry={load} /></div>}
        <MetricStrip className="mb-5">
          <Metric label="活跃任务" value={activeTasks.length} detail={`${assignedTasks.length} 已分配`} tone="accent" />
          <Metric label="Agent" value={agents.length} detail="可编排执行者" tone="muted" />
          <Metric label="待办" value={tasks.filter(t => t.status === 'todo').length} detail="尚未启动" tone="warning" />
          <Metric label="完成" value={tasks.filter(t => t.status === 'done').length} detail="历史结果" tone="success" />
        </MetricStrip>

        {activeTasks.length === 0 ? (
          <EmptyState
            className="py-16"
            title="还没有活跃任务"
            description="在任务看板创建任务并分配 Agent 后，编排链会在这里展示。"
          />
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-5 max-[1100px]:grid-cols-1">
            <Panel title="编排队列" meta={`${activeTasks.length}`}>
              <div className="divide-y divide-border/70">
            {activeTasks.map(task => (
              <div key={task.id} className="p-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1">
                    <div className="text-[15px] font-semibold">{task.title}</div>
                    <div className="text-xs text-text-muted mt-0.5">{task.description || '无描述'}</div>
                  </div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_BADGE[task.status] || STATUS_BADGE.todo}`}>
                    {STATUS_LABELS[task.status] || task.status}
                  </span>
                </div>

                <div className="flex items-center gap-3 p-2 px-3 bg-surface-elevated rounded-[8px] text-xs mb-4">
                  <span className="text-text-dim">编排者:</span>
                  <AgentAvatar name={getAgentName(task.created_by)} displayName={getAgentName(task.created_by)} size="sm" />
                  <span className="text-[13px] font-medium">{getAgentName(task.created_by)}</span>
                </div>

                <div className="flex flex-col gap-0">
                  <OrchStep
                    nodeType="human"
                    title="任务创建"
                    desc={`${getAgentName(task.created_by)} 创建了任务`}
                  />
                  {task.assigned_to && (
                    <OrchStep
                      nodeType="worker"
                      title={`${getAgentName(task.assigned_to)} 执行中`}
                      desc={task.description || '正在处理...'}
                    />
                  )}
                </div>
              </div>
            ))}
              </div>
            </Panel>

            <aside>
              <Panel title="编排原理" meta="model">
              <div className="p-3 space-y-2">
                <InfoCard title="没有固定主 agent" desc="任何 agent 都可以是 Orchestrator。人类和谁对话，谁就是当前焦点。" />
                <InfoCard title="按任务分配编排者" desc="每个任务有自己的编排者。创建任务时可以指定任意 agent。" />
                <InfoCard title="Harness ≠ Orchestrator" desc="Harness = Server 内置模块（状态机）。Orchestrator = agent 角色（AI 驱动）。" />
                <InfoCard title="平等交流" desc="进入房间的 agent 都可以互相交流。协作是 peer-to-peer 的。" />
              </div>
              </Panel>
            </aside>
          </div>
        )}
      </PageShell>
    </div>
  );
}

function OrchStep({ nodeType, title, desc }: { nodeType: 'human' | 'orch' | 'worker' | 'result'; title: string; desc: string }) {
  const borderMap = {
    human: 'border-accent bg-accent-muted',
    orch: 'border-[#FBBF24] bg-[#78350F]',
    worker: 'border-[#34D399] bg-[#064E3B]',
    result: 'border-text-dim bg-surface',
  };
  const labelMap = {
    human: '人',
    orch: '编',
    worker: 'Agent',
    result: '果',
  };

  return (
    <div className="flex gap-4 relative">
      <div className="absolute left-[20px] top-[44px] bottom-[-16px] w-0.5 bg-border last:hidden" />
      <div className={`w-[42px] h-[42px] rounded-full flex items-center justify-center text-base shrink-0 border-2 z-10 ${borderMap[nodeType]}`}>
        <span className="text-[11px] font-bold">{labelMap[nodeType]}</span>
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
    <div className="rounded-[8px] p-3 hover:bg-surface-elevated/50 transition-colors">
      <div className="text-[13px] font-semibold mb-1.5">{title}</div>
      <div className="text-xs text-text-muted">{desc}</div>
    </div>
  );
}
