import { get, post, patch } from './client';
import type { Task, TaskDetail, CreateTaskRequest, ListTasksResponse, UpdateTaskRequest } from '@flock/shared';

export async function listTasks(token: string, roomId?: string): Promise<ListTasksResponse> {
  const params = roomId ? `?room_id=${roomId}` : '';
  return get<ListTasksResponse>(`/tasks${params}`, token);
}

export async function getTask(token: string, taskId: string): Promise<TaskDetail> {
  return get<TaskDetail>(`/tasks/${taskId}`, token);
}

export async function createTask(token: string, data: CreateTaskRequest): Promise<Task> {
  return post<Task>('/tasks', token, data);
}

export async function updateTask(token: string, taskId: string, data: UpdateTaskRequest): Promise<Task> {
  return patch<Task>(`/tasks/${taskId}`, token, data);
}
