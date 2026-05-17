import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { listTasks, createTask, updateTask } from '../api/tasks';
import { get } from '../api/client';
import type { Task, TaskStatus } from '@flock/shared';

interface Room {
  id: string;
  name: string;
}

const columns: { status: TaskStatus; label: string; color: string }[] = [
  { status: 'todo', label: 'To Do', color: 'bg-text-muted' },
  { status: 'in_progress', label: 'In Progress', color: 'bg-accent' },
  { status: 'review', label: 'Review', color: 'bg-warning' },
  { status: 'done', label: 'Done', color: 'bg-success' },
];

const priorityBadge: Record<string, { label: string; cls: string }> = {
  urgent: { label: 'URGENT', cls: 'bg-error/10 text-error' },
  high: { label: 'HIGH', cls: 'bg-warning/10 text-warning' },
  normal: { label: '', cls: '' },
  low: { label: 'LOW', cls: 'bg-text-muted/10 text-text-muted' },
};

export function TaskBoardPage() {
  const { token } = useAuth();
  const { subscribe } = useSSE();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newRoom, setNewRoom] = useState('');
  const [newPriority, setNewPriority] = useState<string>('normal');

  const loadTasks = useCallback(async () => {
    if (!token) return;
    try {
      const res = await listTasks(token, selectedRoom || undefined);
      setTasks(res.tasks);
    } catch {
      // API may not be ready yet
    } finally {
      setLoading(false);
    }
  }, [token, selectedRoom]);

  useEffect(() => {
    if (!token) return;
    get<{ rooms: Room[] }>('/rooms', token)
      .then(r => {
        setRooms(r.rooms);
        if (r.rooms.length > 0 && !newRoom) setNewRoom(r.rooms[0].id);
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // SSE: refresh on task events
  useEffect(() => {
    return subscribe(event => {
      if (event.event === 'task_created' || event.event === 'task_status') {
        loadTasks();
      }
    });
  }, [subscribe, loadTasks]);

  const handleCreate = async () => {
    if (!token || !newTitle.trim() || !newRoom) return;
    try {
      await createTask(token, {
        room_id: newRoom,
        title: newTitle.trim(),
        priority: newPriority as Task['priority'],
      });
      setNewTitle('');
      setShowCreate(false);
      await loadTasks();
    } catch {
      // ignore
    }
  };

  const handleStatusChange = async (taskId: string, status: TaskStatus) => {
    if (!token) return;
    try {
      await updateTask(token, taskId, { status });
      await loadTasks();
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-text-muted">Loading tasks...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-border shrink-0 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Task Board</h2>
          <p className="text-sm text-text-muted">Track agent tasks across rooms</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedRoom}
            onChange={e => setSelectedRoom(e.target.value)}
            className="px-2 py-1 text-xs bg-surface-elevated border border-border rounded-md text-text"
          >
            <option value="">All rooms</option>
            {rooms.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-md hover:opacity-90 transition-opacity"
          >
            + New Task
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex gap-4 h-full min-w-[800px]">
          {columns.map(col => {
            const colTasks = tasks.filter(t => t.status === col.status);
            return (
              <div key={col.status} className="flex-1 flex flex-col min-w-[200px]">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <span className={`w-2 h-2 rounded-full ${col.color}`} />
                  <h3 className="text-sm font-medium text-text">{col.label}</h3>
                  <span className="text-xs text-text-muted font-mono">{colTasks.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2">
                  {colTasks.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onStatusChange={handleStatusChange}
                    />
                  ))}
                  {colTasks.length === 0 && (
                    <div className="p-3 text-xs text-text-muted text-center border border-dashed border-border rounded-lg">
                      No tasks
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="w-96 p-5 bg-surface rounded-lg border border-border" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-3">Create Task</h3>
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="Task title"
              autoFocus
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent mb-2"
            />
            <select
              value={newRoom}
              onChange={e => setNewRoom(e.target.value)}
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text mb-2"
            >
              {rooms.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <select
              value={newPriority}
              onChange={e => setNewPriority(e.target.value)}
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text mb-3"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-3 py-1.5 text-xs text-text-muted hover:text-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newTitle.trim()}
                className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, onStatusChange }: { task: Task; onStatusChange: (id: string, status: TaskStatus) => void }) {
  const badge = priorityBadge[task.priority] ?? priorityBadge.normal;
  const nextStatus: Partial<Record<TaskStatus, TaskStatus>> = {
    todo: 'in_progress',
    in_progress: 'review',
    review: 'done',
  };
  const next = nextStatus[task.status];

  return (
    <div className="p-3 bg-surface border border-border rounded-lg hover:border-accent/30 transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-text font-medium leading-snug">{task.title}</p>
        {badge.label && (
          <span className={`shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded ${badge.cls}`}>
            {badge.label}
          </span>
        )}
      </div>
      {task.description && (
        <p className="text-xs text-text-muted mt-1 line-clamp-2">{task.description}</p>
      )}
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-text-muted font-mono">
          {task.assigned_to ? task.assigned_to.slice(0, 8) : 'unassigned'}
        </span>
        {next && (
          <button
            onClick={() => onStatusChange(task.id, next)}
            className="opacity-0 group-hover:opacity-100 px-2 py-0.5 text-[10px] font-medium bg-accent/10 text-accent rounded transition-opacity"
          >
            {next === 'in_progress' ? 'Start' : next === 'review' ? 'Review' : 'Done'}
          </button>
        )}
      </div>
    </div>
  );
}
