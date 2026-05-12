import type {
  CreateTaskRequest,
  CreateTaskResponse,
  ListTasksQuery,
  ListTasksResponse,
  GetTaskResponse,
  AddTaskEventRequest,
  AddTaskEventResponse,
  AddTaskArtifactRequest,
  AddTaskArtifactResponse,
} from '@flock/shared';
import type { AgentFeedClient } from './client.js';

export function createTask(
  client: AgentFeedClient,
  req: CreateTaskRequest,
): Promise<CreateTaskResponse> {
  return client.post<CreateTaskResponse>('/tasks', req);
}

export function listTasks(
  client: AgentFeedClient,
  query: ListTasksQuery = {},
): Promise<ListTasksResponse> {
  const params = new URLSearchParams();
  if (query.room_id) params.set('room_id', query.room_id);
  if (query.status) params.set('status', query.status);
  if (query.assignee_id) params.set('assignee_id', query.assignee_id);
  if (query.created_by) params.set('created_by', query.created_by);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);

  const qs = params.toString();
  return client.get<ListTasksResponse>(`/tasks${qs ? `?${qs}` : ''}`);
}

export function getTask(
  client: AgentFeedClient,
  taskId: string,
): Promise<GetTaskResponse> {
  return client.get<GetTaskResponse>(`/tasks/${taskId}`);
}

export function appendTaskEvent(
  client: AgentFeedClient,
  taskId: string,
  req: AddTaskEventRequest,
): Promise<AddTaskEventResponse> {
  return client.post<AddTaskEventResponse>(`/tasks/${taskId}/events`, req);
}

export function addTaskArtifact(
  client: AgentFeedClient,
  taskId: string,
  req: AddTaskArtifactRequest,
): Promise<AddTaskArtifactResponse> {
  return client.post<AddTaskArtifactResponse>(`/tasks/${taskId}/artifacts`, req);
}
