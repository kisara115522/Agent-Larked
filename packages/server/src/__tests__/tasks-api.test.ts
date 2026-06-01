import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { createApp } from '../index.js';
import { bootstrapDefaultAgent } from '../db.js';
import { hashToken } from '../middleware/auth.js';
import { checkStaleTasks } from '../services/task.js';

let app: Express;
let db: Database.Database;

describe('Tasks API', () => {
  let agentToken: string;
  let agentId: string;
  let roomId: string;

  beforeAll(async () => {
    ({ app, db } = createApp());
    bootstrapDefaultAgent(db, hashToken);

    const reg = await request(app).post('/agents').send({ name: 'TaskBot' }).expect(201);
    agentToken = reg.body.token;
    agentId = reg.body.id;

    const room = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ name: 'task-room' })
      .expect(201);
    roomId = room.body.id;
  });

  it('creates a task', async () => {
    const res = await request(app)
      .post('/tasks')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ room_id: roomId, title: 'Review PR #42', description: 'Check security', priority: 2 })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.title).toBe('Review PR #42');
    expect(res.body.status).toBe('todo');
    expect(res.body.priority).toBe(2);
  });

  it('lists tasks by room', async () => {
    const res = await request(app)
      .get(`/tasks?room_id=${roomId}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(res.body.tasks.length).toBeGreaterThanOrEqual(1);
    expect(res.body.tasks[0].room_id).toBe(roomId);
  });

  it('updates task status', async () => {
    const list = await request(app)
      .get(`/tasks?room_id=${roomId}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    const taskId = list.body.tasks[0].id;

    const res = await request(app)
      .patch(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'in_progress' })
      .expect(200);

    expect(res.body.status).toBe('in_progress');
  });

  it('rejects invalid status transition', async () => {
    const list = await request(app)
      .get(`/tasks?room_id=${roomId}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    const taskId = list.body.tasks[0].id;

    // in_progress → todo is invalid
    await request(app)
      .patch(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'todo' })
      .expect(400);
  });

  it('gets single task', async () => {
    const list = await request(app)
      .get(`/tasks?room_id=${roomId}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    const taskId = list.body.tasks[0].id;

    const res = await request(app)
      .get(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(res.body.id).toBe(taskId);
  });

  it('returns task events timeline', async () => {
    const list = await request(app)
      .get(`/tasks?room_id=${roomId}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    const taskId = list.body.tasks[0].id;

    const res = await request(app)
      .get(`/tasks/${taskId}/events`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(res.body.events).toBeDefined();
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events.length).toBeGreaterThanOrEqual(1);
    expect(res.body.events[0].event_type).toBe('created');
  });

  it('returns 404 for events on unknown task', async () => {
    await request(app)
      .get('/tasks/nonexistent/events')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(404);
  });

  it('creates an artifact for a task', async () => {
    const list = await request(app)
      .get(`/tasks?room_id=${roomId}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    const taskId = list.body.tasks[0].id;

    const res = await request(app)
      .post(`/tasks/${taskId}/artifacts`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ name: 'output.json', path: '/tmp/output.json', content_type: 'application/json', size: 1024 })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.task_id).toBe(taskId);
    expect(res.body.name).toBe('output.json');
    expect(res.body.path).toBe('/tmp/output.json');
    expect(res.body.content_type).toBe('application/json');
    expect(res.body.size).toBe(1024);
  });

  it('lists artifacts for a task', async () => {
    const list = await request(app)
      .get(`/tasks?room_id=${roomId}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    const taskId = list.body.tasks[0].id;

    const res = await request(app)
      .get(`/tasks/${taskId}/artifacts`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(res.body.artifacts).toBeDefined();
    expect(Array.isArray(res.body.artifacts)).toBe(true);
    expect(res.body.artifacts.length).toBeGreaterThanOrEqual(1);
    expect(res.body.artifacts[0].name).toBe('output.json');
  });

  it('returns 404 for artifacts on unknown task', async () => {
    await request(app)
      .get('/tasks/nonexistent/artifacts')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(404);
  });

  it('returns 404 when creating artifact for unknown task', async () => {
    await request(app)
      .post('/tasks/nonexistent/artifacts')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ name: 'test.txt', path: '/tmp/test.txt' })
      .expect(404);
  });

  it('returns empty list for task with no artifacts', async () => {
    // Create a fresh task
    const taskRes = await request(app)
      .post('/tasks')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ room_id: roomId, title: 'No artifacts task' })
      .expect(201);

    const res = await request(app)
      .get(`/tasks/${taskRes.body.id}/artifacts`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(res.body.artifacts).toEqual([]);
  });
});

describe('Task Stale Detection', () => {
  let staleDb: Database.Database;

  beforeAll(() => {
    ({ db: staleDb } = createApp());
    bootstrapDefaultAgent(staleDb, hashToken);
    staleDb.prepare("INSERT INTO profiles (id, name, status, token_hash, created_at, updated_at) VALUES ('test-agent', 'TestBot', 'online', 'test-hash', datetime('now'), datetime('now'))").run();
  });

  it('retries stale tasks within max_retries', () => {
    const roomId = 'stale-room-1';
    staleDb.prepare("INSERT INTO rooms (id, name, visibility, created_by, created_at) VALUES (?, 'test', 'public', 'test-agent', datetime('now'))").run(roomId);
    staleDb.prepare("INSERT INTO room_members (room_id, agent_id, joined_at) VALUES (?, 'test-agent', datetime('now'))").run(roomId);

    const taskId = 'stale-task-1';
    staleDb.prepare(`
      INSERT INTO tasks (id, room_id, title, status, priority, max_retries, retry_count, created_by, created_at, updated_at)
      VALUES (?, ?, 'Stale task', 'in_progress', 0, 3, 0, 'test-agent', datetime('now'), datetime('now', '-1 hour'))
    `).run(taskId, roomId);

    const staleIds = checkStaleTasks(staleDb, 30 * 60 * 1000);
    expect(staleIds).toContain(taskId);

    const task = staleDb.prepare('SELECT status, retry_count FROM tasks WHERE id = ?').get(taskId) as { status: string; retry_count: number };
    expect(task.status).toBe('todo');
    expect(task.retry_count).toBe(1);
  });

  it('marks tasks as error when max_retries exceeded', () => {
    const roomId = 'stale-room-2';
    staleDb.prepare("INSERT INTO rooms (id, name, visibility, created_by, created_at) VALUES (?, 'test2', 'public', 'test-agent', datetime('now'))").run(roomId);
    staleDb.prepare("INSERT INTO room_members (room_id, agent_id, joined_at) VALUES (?, 'test-agent', datetime('now'))").run(roomId);

    const taskId = 'stale-task-2';
    staleDb.prepare(`
      INSERT INTO tasks (id, room_id, title, status, priority, max_retries, retry_count, created_by, created_at, updated_at)
      VALUES (?, ?, 'Exhausted task', 'in_progress', 0, 2, 2, 'test-agent', datetime('now'), datetime('now', '-1 hour'))
    `).run(taskId, roomId);

    const staleIds = checkStaleTasks(staleDb, 30 * 60 * 1000);
    expect(staleIds).toContain(taskId);

    const task = staleDb.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId) as { status: string };
    expect(task.status).toBe('error');
  });

  it('ignores tasks within timeout', () => {
    const roomId = 'stale-room-3';
    staleDb.prepare("INSERT INTO rooms (id, name, visibility, created_by, created_at) VALUES (?, 'test3', 'public', 'test-agent', datetime('now'))").run(roomId);
    staleDb.prepare("INSERT INTO room_members (room_id, agent_id, joined_at) VALUES (?, 'test-agent', datetime('now'))").run(roomId);

    const taskId = 'fresh-task';
    staleDb.prepare(`
      INSERT INTO tasks (id, room_id, title, status, priority, max_retries, retry_count, created_by, created_at, updated_at)
      VALUES (?, ?, 'Fresh task', 'in_progress', 0, 3, 0, 'test-agent', datetime('now'), datetime('now'))
    `).run(taskId, roomId);

    // Use a very short timeout so only tasks older than 1ms are stale
    const staleIds = checkStaleTasks(staleDb, 1);
    // The fresh task should not be in the stale list (but tasks from previous tests may be)
    const freshTaskStale = staleIds.includes(taskId);
    expect(freshTaskStale).toBe(false);
  });
});
