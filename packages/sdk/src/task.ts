import type { Task, TaskPriority } from '@flock/shared';
import type { AgentFeedClient } from './client.js';

// --- SDK-level types (CLI-facing) ---

export type ArtifactType = 'text' | 'json' | 'code' | 'uri';

export interface TaskDetailResponse {
  task: Task;
  assignees: string[];
  events: TaskEventItem[];
  artifacts: TaskArtifactItem[];
}

export interface TaskEventItem {
  id: string;
  task_id: string;
  type: string;
  actor_id: string;
  from_status: string;
  to_status: string;
  body: string | null;
  created_at: string;
}

export interface TaskArtifactItem {
  id: string;
  type: ArtifactType;
  name: string;
  created_at: string;
}

export interface CreateTaskParams {
  room_id: string;
  title: string;
  description?: string;
  assignees?: string[];
  origin_message_id?: string;
  priority?: TaskPriority;
  idempotency_key?: string;
}

export interface ListTasksParams {
  room_id?: string;
  status?: string;
  assignee_id?: string;
  created_by?: string;
  limit?: number;
  cursor?: string;
}

export interface AppendTaskEventParams {
  status?: string;
  body?: string;
  idempotency_key?: string;
}

export interface AddTaskArtifactParams {
  type: ArtifactType;
  name: string;
  content?: string;
  uri?: string;
  mime_type?: string;
  idempotency_key?: string;
}

// --- Priority mapping ---

const PRIORITY_MAP: Record<TaskPriority, number> = {
  low: -1,
  normal: 0,
  high: 1,
  urgent: 2,
};

// --- Server response types (internal) ---

interface ServerTask {
  id: string;
  room_id: string;
  parent_task_id: string | null;
  title: string;
  description: string;
  status: string;
  assigned_to: string | null;
  required_capabilities: string[];
  priority: number;
  retry_count: number;
  max_retries: number;
  message_id: string | null;
  orchestrator_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface ServerTaskEvent {
  id: string;
  task_id: string;
  event_type: string;
  actor_id: string;
  actor_name: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

interface ServerTaskArtifact {
  id: string;
  task_id: string;
  agent_id: string;
  name: string;
  path: string;
  content_type: string;
  size: number;
  created_at: string;
}

// --- SDK functions ---

export async function createTask(
  client: AgentFeedClient,
  params: CreateTaskParams,
): Promise<Task> {
  return client.post<Task>('/tasks', {
    room_id: params.room_id,
    title: params.title,
    description: params.description,
    assigned_to: params.assignees?.[0],
    priority: params.priority ? PRIORITY_MAP[params.priority] : undefined,
    message_id: params.origin_message_id,
  });
}

export async function listTasks(
  client: AgentFeedClient,
  params: ListTasksParams,
): Promise<{ tasks: Task[]; next_cursor: string | null; has_more: boolean }> {
  const qs = new URLSearchParams();
  if (params.room_id) qs.set('room_id', params.room_id);
  if (params.status) qs.set('status', params.status);
  if (params.assignee_id) qs.set('assigned_to', params.assignee_id);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.cursor) qs.set('cursor', params.cursor);
  const query = qs.toString();
  return client.get(`/tasks${query ? `?${query}` : ''}`);
}

export async function getTask(
  client: AgentFeedClient,
  taskId: string,
): Promise<TaskDetailResponse> {
  const [task, eventsResp, artifactsResp] = await Promise.all([
    client.get<ServerTask>(`/tasks/${taskId}`),
    client.get<{ events: ServerTaskEvent[] }>(`/tasks/${taskId}/events`).catch(() => ({ events: [] })),
    client.get<{ artifacts: ServerTaskArtifact[] }>(`/tasks/${taskId}/artifacts`).catch(() => ({ artifacts: [] })),
  ]);

  const assignees = task.assigned_to ? [task.assigned_to] : [];

  const events: TaskEventItem[] = eventsResp.events.map(e => ({
    id: e.id,
    task_id: e.task_id,
    type: e.event_type,
    actor_id: e.actor_id,
    from_status: (e.payload as Record<string, unknown> | null)?.from_status as string ?? e.event_type,
    to_status: (e.payload as Record<string, unknown> | null)?.to_status as string ?? '',
    body: (e.payload as Record<string, unknown> | null)?.body as string ?? null,
    created_at: e.created_at,
  }));

  const artifacts: TaskArtifactItem[] = artifactsResp.artifacts.map(a => ({
    id: a.id,
    type: artifactTypeFromContentType(a.content_type),
    name: a.name,
    created_at: a.created_at,
  }));

  return { task: task as unknown as Task, assignees, events, artifacts };
}

export async function appendTaskEvent(
  client: AgentFeedClient,
  taskId: string,
  params: AppendTaskEventParams,
): Promise<TaskEventItem> {
  await client.patch(`/tasks/${taskId}`, { status: params.status });

  const eventsResp = await client.get<{ events: ServerTaskEvent[] }>(`/tasks/${taskId}/events`);
  const last = eventsResp.events[eventsResp.events.length - 1];
  if (!last) {
    return {
      id: crypto.randomUUID(),
      task_id: taskId,
      type: params.status ? 'status_changed' : 'comment',
      actor_id: '',
      from_status: '',
      to_status: params.status ?? '',
      body: params.body ?? null,
      created_at: new Date().toISOString(),
    };
  }
  return {
    id: last.id,
    task_id: last.task_id,
    type: last.event_type,
    actor_id: last.actor_id,
    from_status: (last.payload as Record<string, unknown> | null)?.from_status as string ?? '',
    to_status: (last.payload as Record<string, unknown> | null)?.to_status as string ?? '',
    body: params.body ?? null,
    created_at: last.created_at,
  };
}

export async function addTaskArtifact(
  client: AgentFeedClient,
  taskId: string,
  params: AddTaskArtifactParams,
): Promise<TaskArtifactItem> {
  const result = await client.post<{ id: string; task_id: string; agent_id: string; name: string; path: string; content_type: string; size: number; created_at: string }>(
    `/tasks/${taskId}/artifacts`,
    {
      name: params.name,
      path: params.uri ?? params.content ?? '',
      content_type: params.mime_type ?? (params.type === 'json' ? 'application/json' : params.type === 'code' ? 'text/plain' : 'text/plain'),
      size: params.content?.length ?? 0,
    },
  );
  return {
    id: result.id,
    type: params.type,
    name: result.name,
    created_at: result.created_at,
  };
}

function artifactTypeFromContentType(contentType: string): ArtifactType {
  if (contentType.includes('json')) return 'json';
  if (contentType.includes('javascript') || contentType.includes('typescript') || contentType.includes('x-python')) return 'code';
  if (contentType.includes('uri-list')) return 'uri';
  return 'text';
}
