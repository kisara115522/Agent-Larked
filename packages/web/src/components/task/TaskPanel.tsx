import { useCallback, useEffect, useMemo, useState } from 'react';
import { get, post } from '../../api/client';
import type {
  AddTaskArtifactRequest,
  AddTaskEventRequest,
  AgentProfile,
  ArtifactType,
  CreateTaskRequest,
  CreateTaskResponse,
  GetRoomMembersResponse,
  GetTaskResponse,
  ListTasksResponse,
  Task,
  TaskArtifact,
  TaskEvent,
  TaskPriority,
  TaskStatus,
} from '@flock/shared';

const statusLabels: Record<TaskStatus, string> = {
  open: 'Open',
  accepted: 'Accepted',
  in_progress: 'In progress',
  blocked: 'Blocked',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const priorityLabels: Record<TaskPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

const statusOptions: TaskStatus[] = ['open', 'accepted', 'in_progress', 'blocked', 'completed', 'cancelled'];
const priorityOptions: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
const artifactTypes: ArtifactType[] = ['text', 'json', 'code', 'uri'];

interface TaskPanelProps {
  roomId: string;
  token: string;
  onClose: () => void;
  refreshKey: number;
}

interface CreateTaskForm {
  title: string;
  description: string;
  assignees: string[];
  priority: TaskPriority;
}

interface ArtifactForm {
  type: ArtifactType;
  name: string;
  content: string;
  uri: string;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function nextStatuses(status: TaskStatus): TaskStatus[] {
  switch (status) {
    case 'open':
      return ['accepted', 'in_progress', 'completed', 'cancelled'];
    case 'accepted':
      return ['in_progress', 'blocked', 'completed', 'cancelled'];
    case 'in_progress':
      return ['blocked', 'completed', 'cancelled'];
    case 'blocked':
      return ['in_progress', 'completed', 'cancelled'];
    case 'completed':
    case 'cancelled':
      return [];
  }
}

function statusClass(status: TaskStatus): string {
  switch (status) {
    case 'open':
      return 'border-border text-text-muted bg-surface';
    case 'accepted':
      return 'border-accent/40 text-accent bg-accent-muted/40';
    case 'in_progress':
      return 'border-blue-400/40 text-blue-300 bg-blue-400/10';
    case 'blocked':
      return 'border-warning/40 text-warning bg-warning/10';
    case 'completed':
      return 'border-success/40 text-success bg-success/10';
    case 'cancelled':
      return 'border-error/40 text-error bg-error/10';
  }
}

function eventLabel(event: TaskEvent): string {
  if (event.type === 'status_changed' && event.from_status && event.to_status) {
    return `${statusLabels[event.from_status]} -> ${statusLabels[event.to_status]}`;
  }
  if (event.type === 'assignees_changed') return 'Assignees changed';
  if (event.type === 'artifact_added') return 'Artifact added';
  if (event.type === 'created') return 'Created';
  return 'Commented';
}

function artifactPreview(artifact: TaskArtifact): string {
  if (artifact.type === 'uri') return artifact.uri ?? '';
  return artifact.content ?? '';
}

export function TaskPanel({ roomId, token, onClose, refreshKey }: TaskPanelProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<AgentProfile[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GetTaskResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateTaskForm>({
    title: '',
    description: '',
    assignees: [],
    priority: 'normal',
  });
  const [comment, setComment] = useState('');
  const [artifactForm, setArtifactForm] = useState<ArtifactForm>({
    type: 'text',
    name: '',
    content: '',
    uri: '',
  });

  const visibleTasks = useMemo(() => {
    return statusFilter === 'all' ? tasks : tasks.filter(task => task.status === statusFilter);
  }, [statusFilter, tasks]);

  const memberNameById = useMemo(() => {
    return new Map(members.map(member => [member.id, member.display_name || member.name]));
  }, [members]);

  const agentName = useCallback((agentId: string): string => {
    return memberNameById.get(agentId) ?? agentId.slice(0, 8);
  }, [memberNameById]);

  const selectedTask = detail?.task ?? tasks.find(task => task.id === selectedTaskId) ?? null;

  const loadTasks = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams({ room_id: roomId, limit: '100' });
      const res = await get<ListTasksResponse>(`/tasks?${params}`, token);
      setTasks(res.tasks);
      setSelectedTaskId(current => {
        if (res.tasks.length === 0) return null;
        if (current && res.tasks.some(task => task.id === current)) return current;
        return res.tasks[0].id;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [roomId, token]);

  const loadMembers = useCallback(async () => {
    try {
      const res = await get<GetRoomMembersResponse>(`/rooms/${roomId}/members`, token);
      setMembers(res.members);
    } catch {
      setMembers([]);
    }
  }, [roomId, token]);

  const loadDetail = useCallback(async (taskId: string) => {
    try {
      setDetailLoading(true);
      setError(null);
      const res = await get<GetTaskResponse>(`/tasks/${taskId}`, token);
      setDetail(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load task detail');
    } finally {
      setDetailLoading(false);
    }
  }, [token]);

  useEffect(() => {
    setLoading(true);
    setSelectedTaskId(null);
    setDetail(null);
  }, [roomId]);

  useEffect(() => {
    void loadMembers();
    void loadTasks();
  }, [loadMembers, loadTasks]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks, refreshKey]);

  useEffect(() => {
    if (!selectedTaskId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedTaskId);
  }, [loadDetail, selectedTaskId]);

  const createTask = async () => {
    const title = createForm.title.trim();
    if (!title) return;
    const body: CreateTaskRequest = {
      room_id: roomId,
      title,
      description: createForm.description.trim(),
      assignees: createForm.assignees.length > 0 ? createForm.assignees : undefined,
      priority: createForm.priority,
      idempotency_key: crypto.randomUUID(),
    };
    try {
      setError(null);
      const created = await post<CreateTaskResponse>('/tasks', token, body);
      setCreateForm({ title: '', description: '', assignees: [], priority: 'normal' });
      setShowCreate(false);
      setSelectedTaskId(created.id);
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    }
  };

  const appendEvent = async (body: AddTaskEventRequest) => {
    if (!selectedTaskId) return;
    try {
      setError(null);
      await post(`/tasks/${selectedTaskId}/events`, token, body);
      setComment('');
      await loadTasks();
      await loadDetail(selectedTaskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task');
    }
  };

  const addArtifact = async () => {
    if (!selectedTaskId || !artifactForm.name.trim()) return;
    if (artifactForm.type === 'json') {
      try {
        JSON.parse(artifactForm.content);
      } catch {
        setError('JSON artifact content must be valid JSON');
        return;
      }
    }
    const body: AddTaskArtifactRequest = {
      type: artifactForm.type,
      name: artifactForm.name.trim(),
      mime_type: artifactForm.type === 'code' ? 'text/plain' : undefined,
      idempotency_key: crypto.randomUUID(),
    };
    if (artifactForm.type === 'uri') {
      body.uri = artifactForm.uri.trim();
    } else {
      body.content = artifactForm.content;
    }
    try {
      setError(null);
      await post(`/tasks/${selectedTaskId}/artifacts`, token, body);
      setArtifactForm({ type: 'text', name: '', content: '', uri: '' });
      await loadTasks();
      await loadDetail(selectedTaskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add artifact');
    }
  };

  const toggleAssignee = (agentId: string) => {
    setCreateForm(prev => ({
      ...prev,
      assignees: prev.assignees.includes(agentId)
        ? prev.assignees.filter(id => id !== agentId)
        : [...prev.assignees, agentId],
    }));
  };

  return (
    <div className="h-full flex bg-surface border-l border-border">
      <div className="w-80 border-r border-border flex flex-col shrink-0">
        <header className="px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-text">Tasks</h3>
              <p className="text-xs text-text-muted">{tasks.length} total</p>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-elevated transition-colors"
              title="Close tasks"
            >
              x
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <select
              value={statusFilter}
              onChange={event => setStatusFilter(event.target.value as TaskStatus | 'all')}
              className="flex-1 bg-surface-elevated border border-border rounded-md px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
            >
              <option value="all">All statuses</option>
              {statusOptions.map(status => (
                <option key={status} value={status}>{statusLabels[status]}</option>
              ))}
            </select>
            <button
              onClick={() => setShowCreate(value => !value)}
              className="px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:opacity-90 transition-opacity"
            >
              New
            </button>
          </div>
        </header>

        {showCreate && (
          <div className="p-3 border-b border-border bg-bg/35">
            <input
              value={createForm.title}
              onChange={event => setCreateForm(prev => ({ ...prev, title: event.target.value }))}
              placeholder="Task title"
              className="w-full bg-surface-elevated border border-border rounded-md px-3 py-2 text-sm text-text outline-none focus:border-accent"
            />
            <textarea
              value={createForm.description}
              onChange={event => setCreateForm(prev => ({ ...prev, description: event.target.value }))}
              placeholder="Description"
              rows={3}
              className="mt-2 w-full bg-surface-elevated border border-border rounded-md px-3 py-2 text-sm text-text outline-none focus:border-accent resize-none"
            />
            <select
              value={createForm.priority}
              onChange={event => setCreateForm(prev => ({ ...prev, priority: event.target.value as TaskPriority }))}
              className="mt-2 w-full bg-surface-elevated border border-border rounded-md px-3 py-2 text-sm text-text outline-none focus:border-accent"
            >
              {priorityOptions.map(priority => (
                <option key={priority} value={priority}>{priorityLabels[priority]}</option>
              ))}
            </select>
            {members.length > 0 && (
              <div className="mt-2 max-h-28 overflow-y-auto border border-border rounded-md">
                {members.map(member => (
                  <label
                    key={member.id}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-text-muted hover:bg-surface-elevated"
                  >
                    <input
                      type="checkbox"
                      checked={createForm.assignees.includes(member.id)}
                      onChange={() => toggleAssignee(member.id)}
                      className="accent-accent"
                    />
                    <span className="truncate">{member.display_name || member.name}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-3 py-1.5 rounded-md border border-border text-xs text-text-muted hover:text-text hover:bg-surface-elevated"
              >
                Cancel
              </button>
              <button
                onClick={createTask}
                disabled={!createForm.title.trim()}
                className="px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium disabled:opacity-40 hover:opacity-90"
              >
                Create
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-xs text-text-muted">Loading tasks...</p>
            </div>
          ) : visibleTasks.length === 0 ? (
            <div className="h-full flex items-center justify-center px-5 text-center">
              <p className="text-sm text-text-muted">No tasks</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visibleTasks.map(task => (
                <button
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className={`w-full text-left px-4 py-3 transition-colors ${
                    selectedTaskId === task.id ? 'bg-accent-muted/35' : 'hover:bg-surface-elevated/60'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full border text-[11px] ${statusClass(task.status)}`}>
                      {statusLabels[task.status]}
                    </span>
                    <span className="text-[11px] text-text-muted">{priorityLabels[task.priority]}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-text line-clamp-2">{task.title}</p>
                  <p className="mt-1 text-[11px] text-text-muted">
                    {task.assignees.length > 0
                      ? task.assignees.map(agentName).join(', ')
                      : 'Unassigned'}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <section className="w-[30rem] flex flex-col shrink-0">
        {selectedTask ? (
          <>
            <header className="px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-text break-words">{selectedTask.title}</h3>
                  <p className="text-[11px] text-text-muted font-mono mt-1">{selectedTask.id.slice(0, 8)}</p>
                </div>
                <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[11px] ${statusClass(selectedTask.status)}`}>
                  {statusLabels[selectedTask.status]}
                </span>
              </div>
              {selectedTask.description && (
                <p className="mt-3 text-sm text-text-muted leading-relaxed whitespace-pre-wrap break-words">
                  {selectedTask.description}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {selectedTask.assignees.length > 0 ? selectedTask.assignees.map(id => (
                  <span key={id} className="px-2 py-0.5 rounded-full bg-surface-elevated text-[11px] text-text-muted">
                    {agentName(id)}
                  </span>
                )) : (
                  <span className="px-2 py-0.5 rounded-full bg-surface-elevated text-[11px] text-text-muted">Unassigned</span>
                )}
              </div>
            </header>

            <div className="flex-1 overflow-y-auto">
              {detailLoading ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-xs text-text-muted">Loading task...</p>
                </div>
              ) : (
                <div className="p-4 space-y-5">
                  <section>
                    <h4 className="text-[11px] font-semibold text-text-muted uppercase">Status</h4>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {nextStatuses(selectedTask.status).map(status => (
                        <button
                          key={status}
                          onClick={() => appendEvent({ status, idempotency_key: crypto.randomUUID() })}
                          className="px-3 py-1.5 rounded-md border border-border bg-surface-elevated text-xs text-text hover:border-accent hover:text-accent"
                        >
                          {statusLabels[status]}
                        </button>
                      ))}
                      {nextStatuses(selectedTask.status).length === 0 && (
                        <span className="text-xs text-text-muted">Terminal</span>
                      )}
                    </div>
                  </section>

                  <section>
                    <h4 className="text-[11px] font-semibold text-text-muted uppercase">Comment</h4>
                    <textarea
                      value={comment}
                      onChange={event => setComment(event.target.value)}
                      rows={3}
                      className="mt-2 w-full bg-surface-elevated border border-border rounded-md px-3 py-2 text-sm text-text outline-none focus:border-accent resize-none"
                    />
                    <div className="mt-2 flex justify-end">
                      <button
                        onClick={() => appendEvent({ body: comment.trim(), idempotency_key: crypto.randomUUID() })}
                        disabled={!comment.trim()}
                        className="px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium disabled:opacity-40 hover:opacity-90"
                      >
                        Add
                      </button>
                    </div>
                  </section>

                  <section>
                    <h4 className="text-[11px] font-semibold text-text-muted uppercase">Artifacts</h4>
                    <div className="mt-2 space-y-2">
                      {(detail?.artifacts ?? []).map(artifact => (
                        <div key={artifact.id} className="border border-border rounded-md p-3 bg-bg/30">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-text truncate">{artifact.name}</span>
                            <span className="text-[11px] text-text-muted">{artifact.type}</span>
                          </div>
                          {artifact.type === 'uri' && artifact.uri ? (
                            <a
                              href={artifact.uri}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 block text-xs text-accent hover:underline truncate"
                            >
                              {artifact.uri}
                            </a>
                          ) : (
                            <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words text-xs text-text-muted font-mono">
                              {artifactPreview(artifact)}
                            </pre>
                          )}
                        </div>
                      ))}
                      {(detail?.artifacts ?? []).length === 0 && (
                        <p className="text-xs text-text-muted">No artifacts</p>
                      )}
                    </div>
                    <div className="mt-3 border border-border rounded-md p-3 bg-bg/30">
                      <div className="flex gap-2">
                        <select
                          value={artifactForm.type}
                          onChange={event => setArtifactForm(prev => ({ ...prev, type: event.target.value as ArtifactType }))}
                          className="w-24 bg-surface-elevated border border-border rounded-md px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
                        >
                          {artifactTypes.map(type => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                        <input
                          value={artifactForm.name}
                          onChange={event => setArtifactForm(prev => ({ ...prev, name: event.target.value }))}
                          placeholder="Name"
                          className="min-w-0 flex-1 bg-surface-elevated border border-border rounded-md px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
                        />
                      </div>
                      {artifactForm.type === 'uri' ? (
                        <input
                          value={artifactForm.uri}
                          onChange={event => setArtifactForm(prev => ({ ...prev, uri: event.target.value }))}
                          placeholder="URI"
                          className="mt-2 w-full bg-surface-elevated border border-border rounded-md px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
                        />
                      ) : (
                        <textarea
                          value={artifactForm.content}
                          onChange={event => setArtifactForm(prev => ({ ...prev, content: event.target.value }))}
                          rows={3}
                          className="mt-2 w-full bg-surface-elevated border border-border rounded-md px-2 py-1.5 text-xs text-text outline-none focus:border-accent resize-none font-mono"
                        />
                      )}
                      <div className="mt-2 flex justify-end">
                        <button
                          onClick={addArtifact}
                          disabled={!artifactForm.name.trim() || (artifactForm.type === 'uri' ? !artifactForm.uri.trim() : !artifactForm.content)}
                          className="px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium disabled:opacity-40 hover:opacity-90"
                        >
                          Attach
                        </button>
                      </div>
                    </div>
                  </section>

                  <section>
                    <h4 className="text-[11px] font-semibold text-text-muted uppercase">Activity</h4>
                    <div className="mt-2 space-y-2">
                      {(detail?.events ?? []).map(event => (
                        <div key={event.id} className="border-l border-border pl-3 py-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-text">{eventLabel(event)}</span>
                            <span className="text-[11px] text-text-muted shrink-0">{formatTime(event.created_at)}</span>
                          </div>
                          <p className="text-[11px] text-text-muted mt-0.5">
                            {agentName(event.actor_id)}
                          </p>
                          {event.body && (
                            <p className="mt-1 text-xs text-text-muted whitespace-pre-wrap break-words">{event.body}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center px-6 text-center">
            <p className="text-sm text-text-muted">Select a task</p>
          </div>
        )}
        {error && (
          <div className="px-4 py-2 bg-error/10 border-t border-error/20 text-error text-xs flex items-center justify-between gap-3">
            <span className="break-words">{error}</span>
            <button onClick={() => setError(null)} className="shrink-0 text-error/60 hover:text-error">x</button>
          </div>
        )}
      </section>
    </div>
  );
}
