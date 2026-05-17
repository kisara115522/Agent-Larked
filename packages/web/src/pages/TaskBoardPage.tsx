import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { get, post } from '../api/client';
import { TaskDetailModal } from '../components/modals/TaskDetailModal';

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
}

const COLUMNS: { status: string; label: string; icon: string; color: string }[] = [
  { status: 'todo', label: '待办', icon: '📋', color: 'bg-text-dim' },
  { status: 'in_progress', label: '进行中', icon: '⚡', color: 'bg-[#FBBF24]' },
  { status: 'review', label: '审查中', icon: '👀', color: 'bg-accent' },
  { status: 'done', label: '完成', icon: '✅', color: 'bg-[#34D399]' },
  { status: 'rejected', label: '退回', icon: '🚫', color: 'bg-[#FBBF24]' },
  { status: 'error', label: '错误', icon: '❌', color: 'bg-error' },
];

const PRIORITY_LABEL: Record<number, string> = { 0: '低', 1: '中', 2: '高' };
const PRIORITY_BADGE: Record<number, string> = {
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
  const [newPriority, setNewPriority] = useState(1);
  const [creating, setCreating] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

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
      if (roomsRes.rooms.length > 0 && !newRoom) setNewRoom(roomsRes.rooms[0].id);
    } catch {} finally {
      setLoading(false);
    }
  }, [token, newRoom]);

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
    setCreating(true);
    try {
      await post('/tasks', token, {
        title: newTitle.trim(),
        room_id: newRoom || undefined,
        priority: newPriority,
      });
      setNewTitle('');
      setShowCreate(false);
      load();
    } catch {} finally { setCreating(false); }
  };

  if (loading) {
    return <div className="h-full flex items-center justify-center"><p className="text-sm text-text-muted">Loading...</p></div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-border flex items-center gap-3 shrink-0 bg-surface min-h-[56px]">
        <h3 className="text-base font-semibold">任务看板</h3>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-text-muted">v0.5</span>
          <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold bg-accent text-white hover:bg-accent-hover transition-colors">
            + 创建任务
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto">
        <div className="grid grid-cols-6 gap-3.5 p-4 min-w-[1000px]">
          {COLUMNS.map(col => {
            const colTasks = tasks.filter(t => t.status === col.status);
            return (
              <div key={col.status} className="bg-bg border border-border rounded-[10px] flex flex-col min-h-[400px]">
                <div className="p-2.5 px-3.5 border-b border-border flex items-center gap-2 shrink-0">
                  <h4 className="text-[13px] font-semibold flex-1">{col.icon} {col.label}</h4>
                  <span className="text-[11px] text-text-dim bg-surface px-2 py-0.5 rounded-full">{colTasks.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {colTasks.map(task => (
                    <div
                      key={task.id}
                      onClick={() => setSelectedTask(task)}
                      className="bg-surface border border-border rounded-[10px] p-3 mb-2 cursor-pointer hover:border-text-dim transition-colors"
                    >
                      <div className="text-[13px] font-medium mb-1.5">{task.title}</div>
                      <div className="flex items-center gap-2 text-[11px] text-text-muted">
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${PRIORITY_BADGE[task.priority] || PRIORITY_BADGE[1]}`}>
                          {PRIORITY_LABEL[task.priority] || '中'}
                        </span>
                        {task.assigned_to && (
                          <span>{agents.find(a => a.id === task.assigned_to)?.display_name || task.assigned_to.slice(0, 8)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                  {colTasks.length === 0 && (
                    <div className="text-center text-text-dim text-xs py-6">
                      {col.status === 'error' ? '超时/预算超限的任务' : '暂无任务'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Create Task Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="w-[480px] p-6 bg-surface border border-border rounded-[14px]" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">创建任务</h3>
            <div className="mb-4">
              <label className="block text-xs text-text-muted mb-1">任务标题</label>
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="任务标题" className="w-full px-3 py-2.5 bg-surface border border-border rounded-[14px] text-sm text-text placeholder:text-text-dim focus:border-accent" />
            </div>
            <div className="mb-4">
              <label className="block text-xs text-text-muted mb-1">Room</label>
              <select value={newRoom} onChange={e => setNewRoom(e.target.value)} className="w-full px-3 py-2.5 bg-surface border border-border rounded-[14px] text-sm text-text focus:border-accent">
                {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-xs text-text-muted mb-1">优先级</label>
              <select value={newPriority} onChange={e => setNewPriority(Number(e.target.value))} className="w-full px-3 py-2.5 bg-surface border border-border rounded-[14px] text-sm text-text focus:border-accent">
                <option value={0}>低</option>
                <option value={1}>中</option>
                <option value={2}>高</option>
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-text-muted hover:text-text">取消</button>
              <button onClick={handleCreate} disabled={creating || !newTitle.trim()} className="px-4 py-2 text-sm font-semibold bg-accent text-white rounded-full hover:bg-accent-hover disabled:opacity-50">
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          agents={agents}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  );
}
