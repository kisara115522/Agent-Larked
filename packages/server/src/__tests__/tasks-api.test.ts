import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { createApp } from '../index.js';
import { bootstrapDefaultAgent } from '../db.js';
import { hashToken } from '../middleware/auth.js';

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
});
