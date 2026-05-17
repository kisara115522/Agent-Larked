const STATUS_LABEL: Record<string, string> = {
  todo: '待办',
  in_progress: '进行中',
  review: '审查中',
  done: '完成',
  rejected: '退回',
  error: '错误',
};

const STATUS_BADGE: Record<string, string> = {
  todo: 'bg-surface-elevated text-text-dim border border-border',
  in_progress: 'bg-[#78350F] text-[#FBBF24]',
  review: 'bg-accent-muted text-accent',
  done: 'bg-[#064E3B] text-[#34D399]',
  rejected: 'bg-[#78350F] text-[#FBBF24]',
  error: 'bg-error-muted text-error',
};

const PRIORITY_LABEL: Record<number, string> = {
  0: '低',
  1: '中',
  2: '高',
};

const PRIORITY_BADGE: Record<number, string> = {
  0: 'bg-[#064E3B] text-[#34D399]',
  1: 'bg-[#78350F] text-[#FBBF24]',
  2: 'bg-error-muted text-error',
};

interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  assigned_to?: string;
  priority: number;
  created_at: string;
  ring?: number;
}

interface Agent {
  id: string;
  name: string;
  display_name: string;
}

interface TaskEvent {
  time: string;
  type: string;
  desc: string;
}

export function TaskDetailModal({ task, agents, onClose }: {
  task: Task;
  agents: Agent[];
  onClose: () => void;
}) {
  const assignee = task.assigned_to ? agents.find(a => a.id === task.assigned_to) : null;
  const createdTime = new Date(task.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  // Mock timeline events
  const events: TaskEvent[] = [
    { time: createdTime, type: 'created', desc: '任务创建' },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="w-[600px] max-h-[80vh] overflow-y-auto p-6 bg-surface border border-border rounded-[14px] relative" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-text-muted hover:text-text text-xl">×</button>

        <h3 className="text-lg font-bold mb-4">{task.title}</h3>

        <div className="flex gap-2 mb-4">
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_BADGE[task.status] || STATUS_BADGE.todo}`}>
            {STATUS_LABEL[task.status] || task.status}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${PRIORITY_BADGE[task.priority] || PRIORITY_BADGE[1]}`}>
            {PRIORITY_LABEL[task.priority] || '中'}优先级
          </span>
          {task.ring !== undefined && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-surface-elevated text-text-muted border border-border">
              Ring {task.ring}
            </span>
          )}
        </div>

        {task.description && (
          <p className="text-[13px] text-text-muted mb-4">{task.description}</p>
        )}

        {/* Detail Grid */}
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          <div className="bg-bg border border-border rounded-md p-2.5">
            <div className="text-[10px] text-text-dim uppercase tracking-wider">创建时间</div>
            <div className="text-[13px] font-medium font-mono mt-0.5">{createdTime}</div>
          </div>
          <div className="bg-bg border border-border rounded-md p-2.5">
            <div className="text-[10px] text-text-dim uppercase tracking-wider">分配给</div>
            <div className="text-[13px] font-medium mt-0.5">{assignee ? (assignee.display_name || assignee.name) : '未分配'}</div>
          </div>
        </div>

        {/* Timeline */}
        <h4 className="text-sm font-semibold mt-4 mb-2">事件时间线</h4>
        <div className="text-xs text-text-muted">
          {events.map((ev, i) => (
            <div key={i} className="flex gap-2.5 py-1.5 border-b border-border">
              <span className="font-mono text-text-dim w-[50px] shrink-0">{ev.time}</span>
              <span className={`font-semibold w-[70px] shrink-0 ${ev.type === 'rejected' ? 'text-error' : ev.type === 'created' ? 'text-accent' : 'text-accent'}`}>
                {ev.type}
              </span>
              <span>{ev.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
