import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { get, post } from '../api/client';
import { useToast } from '../components/ui/Toast';
import { TaskDetailModal } from '../components/modals/TaskDetailModal';
import { EmptyState, ErrorState, Metric, MetricStrip, PageHeader, PageLoader, PageShell, Panel } from '../components/ui/PageState';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  assigned_to?: string;
  priority: number;
  room_id?: string;
  created_at: string;
}

interface Agent {
  id: string;
  name: string;
  display_name: string;
}

interface Room {
  id: string;
  name: string;
  is_member?: boolean;
}

const COLUMNS: { status: string; label: string; color: string }[] = [
  { status: 'todo', label: '待办', color: 'bg-text-dim' },
  { status: 'in_progress', label: '进行中', color: 'bg-[#FBBF24]' },
  { status: 'review', label: '审查中', color: 'bg-accent' },
  { status: 'done', label: '完成', color: 'bg-[#34D399]' },
  { status: 'rejected', label: '退回', color: 'bg-[#FBBF24]' },
  { status: 'error', label: '错误', color: 'bg-error' },
];

const PRIORITY_LABEL: Record<number, string> = { '-1': '最低', 0: '低', 1: '中', 2: '高' };
const PRIORITY_BADGE: Record<number, string> = {
  '-1': 'bg-[#064E3B] text-[#34D399]',
  0: 'bg-[#064E3B] text-[#34D399]',
  1: 'bg-[#78350F] text-[#FBBF24]',
  2: 'bg-error-muted text-error',
};

export function TaskBoardPage() {
  const { token } = useAuth();
  const { subscribe } = useSSE();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newRoom, setNewRoom] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [newPriority, setNewPriority] = useState(1);
  const [creating, setCreating] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [loadError, setLoadError] = useState('');
  const { toast } = useToast();
  const joinedRooms = rooms.filter(room => room.is_member !== false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [tasksRes, agentsRes, roomsRes] = await Promise.all([
        get<{ tasks: Task[] }>('/tasks', token).catch(() => ({ tasks: [] })),
        get<{ agents: Agent[] }>('/agents', token).catch(() => ({ agents: [] })),
        get<{ rooms: Room[] }>('/rooms', token).catch(() => ({ rooms: [] })),
      ]);
      setTasks(tasksRes.tasks);
      setAgents(agentsRes.agents);
      setRooms(roomsRes.rooms);
      const firstJoined = roomsRes.rooms.find(room => room.is_member !== false);
      setNewRoom(prev => prev || (firstJoined?.id ?? ''));
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '任务看板加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    return subscribe(event => {
      if (event.event === 'task_created' || event.event === 'task_status') {
        load();
      }
    });
  }, [subscribe, load]);

  const handleCreate = async () => {
    if (!token || !newTitle.trim()) return;
    if (!newRoom) {
      toast('请先加入一个 Room');
      return;
    }
    setCreating(true);
    try {
      await post('/tasks', token, {
        title: newTitle.trim(),
        room_id: newRoom || undefined,
        priority: newPriority,
        assigned_to: newAssignee || undefined,
      });
      toast('任务创建成功', 'success');
      setNewTitle('');
      setNewAssignee('');
      setShowCreate(false);
      load();
    } catch (e) { toast(`创建失败: ${e instanceof Error ? e.message : '未知错误'}`); } finally { setCreating(false); }
  };

  if (loading) {
    return <PageLoader label="加载任务" />;
  }

  const openTasks = tasks.filter(t => !['done', 'rejected', 'error'].includes(t.status));
  const activeTasks = tasks.filter(t => t.status === 'in_progress' || t.status === 'review');
  const blockedTasks = tasks.filter(t => t.status === 'rejected' || t.status === 'error');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="任务"
        eyebrow="Workspace"
        subtitle={`${openTasks.length} 个未完成 · ${activeTasks.length} 个推进中`}
        action={
          <button
            onClick={() => setShowCreate(true)}
            disabled={joinedRooms.length === 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-semibold bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
            创建任务
          </button>
        }
      />

      <PageShell>
        {loadError && <div className="mb-4"><ErrorState message={loadError} onRetry={load} /></div>}
        <MetricStrip className="mb-5">
          <Metric label="全部任务" value={tasks.length} detail={`${openTasks.length} 未完成`} tone="accent" />
          <Metric label="进行中" value={activeTasks.length} detail="in progress + review" tone={activeTasks.length > 0 ? 'warning' : 'muted'} />
          <Metric label="阻塞" value={blockedTasks.length} detail="退回或错误" tone={blockedTasks.length > 0 ? 'error' : 'muted'} />
          <Metric label="Room" value={joinedRooms.length} detail="可创建任务的空间" tone="muted" />
        </MetricStrip>

        {tasks.length === 0 ? (
          <EmptyState
            className="h-[420px]"
            title="还没有任务"
            description={joinedRooms.length > 0 ? '创建第一个任务后，看板会按状态显示推进过程。' : '你还没有加入任何 Room。先加入或创建 Room，才能创建任务。'}
            action={joinedRooms.length > 0 && (
              <button
                onClick={() => setShowCreate(true)}
                className="px-4 py-2 rounded-full bg-accent text-white text-[12px] font-semibold hover:bg-accent-hover transition-colors"
              >
                创建任务
              </button>
            )}
          />
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-5 max-[1100px]:grid-cols-1">
            <div className="grid grid-cols-3 gap-4 max-[1200px]:grid-cols-2 max-[760px]:grid-cols-1">
              {COLUMNS.filter(col => ['todo', 'in_progress', 'review'].includes(col.status)).map(col => (
                <TaskColumn
                  key={col.status}
                  column={col}
                  tasks={tasks.filter(t => t.status === col.status)}
                  agents={agents}
                  onSelect={setSelectedTask}
                />
              ))}
            </div>

            <aside className="space-y-4">
              <Panel title="完成与异常" meta={`${tasks.length - openTasks.length}`}>
                <div className="p-2 space-y-1 max-h-[360px] overflow-y-auto">
                  {tasks.filter(t => ['done', 'rejected', 'error'].includes(t.status)).length === 0 ? (
                    <div className="py-8 text-center text-[12px] text-text-dim">还没有历史任务</div>
                  ) : (
                    tasks.filter(t => ['done', 'rejected', 'error'].includes(t.status)).slice(0, 12).map(task => (
                      <TaskRow key={task.id} task={task} agents={agents} onSelect={() => setSelectedTask(task)} compact />
                    ))
                  )}
                </div>
              </Panel>
              <Panel title="高优先级" meta={`${tasks.filter(t => t.priority >= 2).length}`}>
                <div className="p-2 space-y-1">
                  {tasks.filter(t => t.priority >= 2).length === 0 ? (
                    <div className="py-8 text-center text-[12px] text-text-dim">没有高优先级任务</div>
                  ) : (
                    tasks.filter(t => t.priority >= 2).slice(0, 8).map(task => (
                      <TaskRow key={task.id} task={task} agents={agents} onSelect={() => setSelectedTask(task)} compact />
                    ))
                  )}
                </div>
              </Panel>
            </aside>
          </div>
        )}
      </PageShell>

      {/* Create Task Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowCreate(false)} style={{ animation: 'fadeIn .15s ease-out' }}>
          <div className="w-[460px] p-7 bg-surface-elevated border border-border rounded-[14px] shadow-lg" onClick={e => e.stopPropagation()} style={{ animation: 'scaleIn .2s ease-out' }}>
            <h3 className="text-[18px] font-bold mb-6">创建任务</h3>
            <div className="mb-4">
              <label className="block text-[12px] font-semibold text-text-muted mb-2">任务标题</label>
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="任务标题" className="input" autoFocus />
            </div>
            <div className="mb-4">
              <label className="block text-[12px] font-semibold text-text-muted mb-2">Room</label>
              <select value={newRoom} onChange={e => setNewRoom(e.target.value)} className="input">
                {joinedRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {joinedRooms.length === 0 && (
                <p className="text-[11px] text-error mt-2">你还没有加入任何 Room，先到 Room 页面加入或创建一个 Room。</p>
              )}
            </div>
            <div className="mb-4">
              <label className="block text-[12px] font-semibold text-text-muted mb-2">优先级</label>
              <select value={newPriority} onChange={e => setNewPriority(Number(e.target.value))} className="input">
                <option value={0}>低</option>
                <option value={1}>中</option>
                <option value={2}>高</option>
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-[12px] font-semibold text-text-muted mb-2">分配给</label>
              <select value={newAssignee} onChange={e => setNewAssignee(e.target.value)} className="input">
                <option value="">暂不分配</option>
                {agents.map(agent => (
                  <option key={agent.id} value={agent.id}>{agent.display_name || agent.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 justify-end mt-8">
              <button onClick={() => setShowCreate(false)} className="px-5 py-2.5 text-[13px] text-text-muted hover:text-text rounded-full transition-colors">取消</button>
              <button onClick={handleCreate} disabled={creating || !newTitle.trim() || !newRoom} className="px-6 py-2.5 text-[13px] font-semibold bg-accent text-white rounded-full hover:bg-accent-hover disabled:opacity-30 transition-all active:scale-95">
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          agents={agents}
          onUpdated={(task) => {
            setSelectedTask(task);
            setTasks(prev => prev.map(item => item.id === task.id ? task : item));
            load();
          }}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  );
}

function TaskColumn({ column, tasks, agents, onSelect }: {
  column: { status: string; label: string; color: string };
  tasks: Task[];
  agents: Agent[];
  onSelect: (task: Task) => void;
}) {
  return (
    <Panel
      title={column.label}
      meta={`${tasks.length}`}
      action={<span className={`w-2 h-2 rounded-full ${column.color}`} />}
      className="min-h-[460px]"
    >
      <div className="p-2 space-y-2">
        {tasks.map(task => (
          <TaskRow key={task.id} task={task} agents={agents} onSelect={() => onSelect(task)} />
        ))}
        {tasks.length === 0 && (
          <div className="py-12 text-center text-[12px] text-text-dim">没有任务</div>
        )}
      </div>
    </Panel>
  );
}

function TaskRow({ task, agents, onSelect, compact = false }: {
  task: Task;
  agents: Agent[];
  onSelect: () => void;
  compact?: boolean;
}) {
  const assignee = task.assigned_to ? agents.find(a => a.id === task.assigned_to) : undefined;
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left bg-surface-elevated border border-border rounded-[8px] hover:border-accent/40 transition-colors ${compact ? 'p-2.5' : 'p-3'}`}
    >
      <div className="text-[13px] font-semibold leading-snug line-clamp-2">{task.title}</div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-text-dim">
        <span className={`px-1.5 py-0.5 rounded-full font-semibold ${PRIORITY_BADGE[task.priority] || PRIORITY_BADGE[1]}`}>
          {PRIORITY_LABEL[task.priority] || '中'}
        </span>
        <span className="px-1.5 py-0.5 rounded-full bg-surface border border-border">
          {task.status}
        </span>
        {assignee && <span className="truncate">{assignee.display_name || assignee.name}</span>}
      </div>
    </button>
  );
}
