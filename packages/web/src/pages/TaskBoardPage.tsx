import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { get, post } from '../api/client';
import { useToast } from '../components/ui/Toast';
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
  const [newPriority, setNewPriority] = useState(1);
  const [creating, setCreating] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const { toast } = useToast();

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
      setNewRoom(prev => prev || (roomsRes.rooms[0]?.id ?? ''));
    } catch {} finally {
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
    setCreating(true);
    try {
      await post('/tasks', token, {
        title: newTitle.trim(),
        room_id: newRoom || undefined,
        priority: newPriority,
      });
      toast('任务创建成功', 'success');
      setNewTitle('');
      setShowCreate(false);
      load();
    } catch (e) { toast(`创建失败: ${e instanceof Error ? e.message : '未知错误'}`); } finally { setCreating(false); }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
          <p className="text-sm text-text-dim font-medium">加载中</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-12 pt-12 pb-6 shrink-0" style={{ animation: 'fadeUp .4s ease-out' }}>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[36px] font-black tracking-tight leading-none" style={{ fontFamily: 'var(--font-display)' }}>
              任务
            </h1>
            <p className="text-[14px] text-text-dim mt-3 font-medium">{tasks.length} 个任务</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-semibold bg-accent text-white hover:bg-accent-hover transition-colors duration-150"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
            创建任务
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto px-8 pb-8">
        <div className="grid grid-cols-6 gap-3 min-w-[1100px]">
          {COLUMNS.map(col => {
            const colTasks = tasks.filter(t => t.status === col.status);
            return (
              <div key={col.status} className="bg-surface border border-border rounded-[10px] flex flex-col min-h-[400px]">
                <div className="p-3 px-4 border-b border-border flex items-center gap-2 shrink-0">
                  <div className={`w-2 h-2 rounded-full ${col.color}`} />
                  <h4 className="text-[12px] font-semibold flex-1">{col.label}</h4>
                  <span className="text-[10px] text-text-dim font-mono">{colTasks.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {colTasks.map(task => (
                    <div
                      key={task.id}
                      onClick={() => setSelectedTask(task)}
                      className="bg-surface-elevated border border-border rounded-[6px] p-3 cursor-pointer hover:border-accent/40 transition-colors duration-150"
                    >
                      <div className="text-[12px] font-medium mb-2 leading-snug">{task.title}</div>
                      <div className="flex items-center gap-2 text-[10px] text-text-dim">
                        <span className={`px-1.5 py-0.5 rounded-full font-semibold ${PRIORITY_BADGE[task.priority] || PRIORITY_BADGE[1]}`}>
                          {PRIORITY_LABEL[task.priority] || '中'}
                        </span>
                        {task.assigned_to && (
                          <span className="truncate">{agents.find(a => a.id === task.assigned_to)?.display_name || task.assigned_to.slice(0, 8)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                  {colTasks.length === 0 && (
                    <div className="text-center text-text-dim text-[11px] py-8">暂无</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

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
                {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-[12px] font-semibold text-text-muted mb-2">优先级</label>
              <select value={newPriority} onChange={e => setNewPriority(Number(e.target.value))} className="input">
                <option value={0}>低</option>
                <option value={1}>中</option>
                <option value={2}>高</option>
              </select>
            </div>
            <div className="flex gap-3 justify-end mt-8">
              <button onClick={() => setShowCreate(false)} className="px-5 py-2.5 text-[13px] text-text-muted hover:text-text rounded-full transition-colors">取消</button>
              <button onClick={handleCreate} disabled={creating || !newTitle.trim()} className="px-6 py-2.5 text-[13px] font-semibold bg-accent text-white rounded-full hover:bg-accent-hover disabled:opacity-30 transition-all active:scale-95">
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
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  );
}
