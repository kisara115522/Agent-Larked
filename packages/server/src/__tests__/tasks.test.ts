import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestContext, createRoomAsAdmin, registerAgent, type TestContext } from './test-helpers.js';

describe('Task + Artifact (v0.4)', () => {
  let ctx: TestContext;
  let roomId: string;
  let agent1: { id: string; token: string };
  let agent2: { id: string; token: string };

  beforeEach(async () => {
    ctx = createTestContext();
    roomId = await createRoomAsAdmin(ctx.app, ctx.adminToken, 'test-room');
    agent1 = await registerAgent(ctx.app, 'worker-1');
    agent2 = await registerAgent(ctx.app, 'worker-2');

    // Both agents join the room
    await request(ctx.app)
      .post(`/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${agent1.token}`)
      .expect(200);
    await request(ctx.app)
      .post(`/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${agent2.token}`)
      .expect(200);
  });

  describe('POST /tasks', () => {
    it('creates a task', async () => {
      const res = await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          room_id: roomId,
          title: 'Implement feature X',
          description: 'Add the new feature',
          assignees: [agent2.id],
          priority: 'high',
          idempotency_key: 'key-1',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.title).toBe('Implement feature X');
      expect(res.body.status).toBe('open');
      expect(res.body.priority).toBe('high');
      expect(res.body.created_by).toBe(agent1.id);
      expect(res.body.assignees).toContain(agent2.id);
    });

    it('returns 403 for non-room member', async () => {
      const outsider = await registerAgent(ctx.app, 'outsider');

      await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({
          room_id: roomId,
          title: 'Should fail',
          idempotency_key: 'key-fail',
        })
        .expect(403);
    });

    it('validates title length', async () => {
      await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          room_id: roomId,
          title: '',
          idempotency_key: 'key-empty',
        })
        .expect(400);
    });

    it('validates assignees are room members', async () => {
      const outsider = await registerAgent(ctx.app, 'outsider-2');

      await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          room_id: roomId,
          title: 'Should fail',
          assignees: [outsider.id],
          idempotency_key: 'key-assign',
        })
        .expect(403);
    });

    it('supports idempotency', async () => {
      const body = {
        room_id: roomId,
        title: 'Idempotent task',
        idempotency_key: 'key-idem',
      };

      const res1 = await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send(body)
        .expect(201);

      const res2 = await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send(body)
        .expect(201);

      expect(res1.body.id).toBe(res2.body.id);
    });

    it('rejects idempotency key conflict', async () => {
      await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ room_id: roomId, title: 'Task A', idempotency_key: 'key-conflict' })
        .expect(201);

      await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ room_id: roomId, title: 'Task B', idempotency_key: 'key-conflict' })
        .expect(409);
    });
  });

  describe('GET /tasks', () => {
    it('lists tasks in a room', async () => {
      await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ room_id: roomId, title: 'Task 1', idempotency_key: 'k1' })
        .expect(201);

      await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ room_id: roomId, title: 'Task 2', idempotency_key: 'k2' })
        .expect(201);

      const res = await request(ctx.app)
        .get(`/tasks?room_id=${roomId}`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .expect(200);

      expect(res.body.tasks).toHaveLength(2);
      expect(res.body.tasks[0].title).toBe('Task 2'); // newest first
    });

    it('filters by status', async () => {
      const createRes = await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ room_id: roomId, title: 'Task to filter', idempotency_key: 'k3' })
        .expect(201);

      // Transition to in_progress
      await request(ctx.app)
        .post(`/tasks/${createRes.body.id}/events`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ status: 'in_progress', idempotency_key: 'k4' })
        .expect(201);

      const openRes = await request(ctx.app)
        .get(`/tasks?room_id=${roomId}&status=open`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .expect(200);
      expect(openRes.body.tasks).toHaveLength(0);

      const progressRes = await request(ctx.app)
        .get(`/tasks?room_id=${roomId}&status=in_progress`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .expect(200);
      expect(progressRes.body.tasks).toHaveLength(1);
    });

    it('filters by assignee', async () => {
      await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          room_id: roomId,
          title: 'Assigned task',
          assignees: [agent2.id],
          idempotency_key: 'k-assignee-1',
        })
        .expect(201);

      await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          room_id: roomId,
          title: 'Unassigned task',
          idempotency_key: 'k-assignee-2',
        })
        .expect(201);

      const res = await request(ctx.app)
        .get(`/tasks?room_id=${roomId}&assignee_id=${agent2.id}`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .expect(200);

      expect(res.body.tasks).toHaveLength(1);
      expect(res.body.tasks[0].title).toBe('Assigned task');
      expect(res.body.tasks[0].assignees).toContain(agent2.id);
    });
  });

  describe('GET /tasks/:id', () => {
    it('returns task detail with events and artifacts', async () => {
      const createRes = await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          room_id: roomId,
          title: 'Detail task',
          assignees: [agent2.id],
          idempotency_key: 'k5',
        })
        .expect(201);

      const res = await request(ctx.app)
        .get(`/tasks/${createRes.body.id}`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .expect(200);

      expect(res.body.task.title).toBe('Detail task');
      expect(res.body.assignees).toContain(agent2.id);
      expect(res.body.events.length).toBeGreaterThanOrEqual(1); // created event
      expect(res.body.events[0].type).toBe('created');
    });

    it('returns 404 for non-existent task', async () => {
      await request(ctx.app)
        .get('/tasks/non-existent')
        .set('Authorization', `Bearer ${agent1.token}`)
        .expect(404);
    });
  });

  describe('POST /tasks/:id/events', () => {
    it('appends a comment', async () => {
      const createRes = await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ room_id: roomId, title: 'Comment task', idempotency_key: 'k6' })
        .expect(201);

      const res = await request(ctx.app)
        .post(`/tasks/${createRes.body.id}/events`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ body: 'This is a comment', idempotency_key: 'k7' })
        .expect(201);

      expect(res.body.type).toBe('commented');
    });

    it('changes status', async () => {
      const createRes = await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ room_id: roomId, title: 'Status task', idempotency_key: 'k8' })
        .expect(201);

      // open → in_progress
      const res = await request(ctx.app)
        .post(`/tasks/${createRes.body.id}/events`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ status: 'in_progress', body: 'Starting work', idempotency_key: 'k9' })
        .expect(201);

      expect(res.body.type).toBe('status_changed');
      expect(res.body.from_status).toBe('open');
      expect(res.body.to_status).toBe('in_progress');

      // Verify task status updated
      const detail = await request(ctx.app)
        .get(`/tasks/${createRes.body.id}`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .expect(200);
      expect(detail.body.task.status).toBe('in_progress');
    });

    it('rejects invalid transition', async () => {
      const createRes = await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ room_id: roomId, title: 'Bad transition', idempotency_key: 'k10' })
        .expect(201);

      // open → blocked (not allowed)
      await request(ctx.app)
        .post(`/tasks/${createRes.body.id}/events`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ status: 'blocked', idempotency_key: 'k11' })
        .expect(400);
    });

    it('rejects changes to terminal state', async () => {
      const createRes = await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ room_id: roomId, title: 'Terminal task', idempotency_key: 'k12' })
        .expect(201);

      // open → completed
      await request(ctx.app)
        .post(`/tasks/${createRes.body.id}/events`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ status: 'completed', idempotency_key: 'k13' })
        .expect(201);

      // completed → in_progress (should fail)
      await request(ctx.app)
        .post(`/tasks/${createRes.body.id}/events`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ status: 'in_progress', idempotency_key: 'k14' })
        .expect(400);
    });

    it('rejects non-participant', async () => {
      const createRes = await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ room_id: roomId, title: 'Participant check', idempotency_key: 'k15' })
        .expect(201);

      // agent2 is not an assignee or creator
      const outsider = await registerAgent(ctx.app, 'outsider-3');
      await request(ctx.app)
        .post(`/rooms/${roomId}/join`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(200);

      await request(ctx.app)
        .post(`/tasks/${createRes.body.id}/events`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({ body: 'Should fail', idempotency_key: 'k16' })
        .expect(403);
    });
  });

  describe('POST /tasks/:id/artifacts', () => {
    it('adds a text artifact', async () => {
      const createRes = await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ room_id: roomId, title: 'Artifact task', idempotency_key: 'k17' })
        .expect(201);

      const res = await request(ctx.app)
        .post(`/tasks/${createRes.body.id}/artifacts`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          type: 'text',
          name: 'readme.txt',
          content: 'Hello world',
          idempotency_key: 'k18',
        })
        .expect(201);

      expect(res.body.type).toBe('text');
      expect(res.body.name).toBe('readme.txt');

      // Verify artifact appears in task detail
      const detail = await request(ctx.app)
        .get(`/tasks/${createRes.body.id}`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .expect(200);
      expect(detail.body.artifacts).toHaveLength(1);
      expect(detail.body.artifacts[0].name).toBe('readme.txt');
    });

    it('adds a code artifact', async () => {
      const createRes = await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ room_id: roomId, title: 'Code artifact', idempotency_key: 'k19' })
        .expect(201);

      const res = await request(ctx.app)
        .post(`/tasks/${createRes.body.id}/artifacts`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          type: 'code',
          name: 'example.ts',
          content: 'export const x = 1;',
          mime_type: 'text/typescript',
          metadata: { language: 'typescript' },
          idempotency_key: 'k20',
        })
        .expect(201);

      expect(res.body.type).toBe('code');
    });

    it('adds a URI artifact', async () => {
      const createRes = await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ room_id: roomId, title: 'URI artifact', idempotency_key: 'k21' })
        .expect(201);

      const res = await request(ctx.app)
        .post(`/tasks/${createRes.body.id}/artifacts`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          type: 'uri',
          name: 'external-doc',
          uri: 'https://example.com/doc',
          mime_type: 'text/html',
          idempotency_key: 'k22',
        })
        .expect(201);

      expect(res.body.type).toBe('uri');
    });

    it('rejects invalid JSON artifact', async () => {
      const createRes = await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ room_id: roomId, title: 'Bad JSON', idempotency_key: 'k23' })
        .expect(201);

      await request(ctx.app)
        .post(`/tasks/${createRes.body.id}/artifacts`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          type: 'json',
          name: 'bad.json',
          content: 'not json',
          idempotency_key: 'k24',
        })
        .expect(400);
    });

    it('rejects URI artifact without uri', async () => {
      const createRes = await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ room_id: roomId, title: 'Missing URI', idempotency_key: 'k25' })
        .expect(201);

      await request(ctx.app)
        .post(`/tasks/${createRes.body.id}/artifacts`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          type: 'uri',
          name: 'missing',
          idempotency_key: 'k26',
        })
        .expect(400);
    });
  });

  describe('Status machine full path', () => {
    it('completes full lifecycle: open → accepted → in_progress → blocked → in_progress → completed', async () => {
      const createRes = await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          room_id: roomId,
          title: 'Full lifecycle',
          assignees: [agent2.id],
          idempotency_key: 'k27',
        })
        .expect(201);

      const taskId = createRes.body.id;

      // open → accepted
      await request(ctx.app)
        .post(`/tasks/${taskId}/events`)
        .set('Authorization', `Bearer ${agent2.token}`)
        .send({ status: 'accepted', idempotency_key: 'k28' })
        .expect(201);

      // accepted → in_progress
      await request(ctx.app)
        .post(`/tasks/${taskId}/events`)
        .set('Authorization', `Bearer ${agent2.token}`)
        .send({ status: 'in_progress', idempotency_key: 'k29' })
        .expect(201);

      // in_progress → blocked
      await request(ctx.app)
        .post(`/tasks/${taskId}/events`)
        .set('Authorization', `Bearer ${agent2.token}`)
        .send({ status: 'blocked', body: 'Waiting for API', idempotency_key: 'k30' })
        .expect(201);

      // blocked → in_progress
      await request(ctx.app)
        .post(`/tasks/${taskId}/events`)
        .set('Authorization', `Bearer ${agent2.token}`)
        .send({ status: 'in_progress', body: 'API ready', idempotency_key: 'k31' })
        .expect(201);

      // in_progress → completed
      await request(ctx.app)
        .post(`/tasks/${taskId}/events`)
        .set('Authorization', `Bearer ${agent2.token}`)
        .send({ status: 'completed', idempotency_key: 'k32' })
        .expect(201);

      // Verify final state
      const detail = await request(ctx.app)
        .get(`/tasks/${taskId}`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .expect(200);

      expect(detail.body.task.status).toBe('completed');
      expect(detail.body.task.completed_at).toBeDefined();
      expect(detail.body.events.length).toBeGreaterThanOrEqual(6); // created + assignees_changed + 4 status changes
    });

    it('cancel from open', async () => {
      const createRes = await request(ctx.app)
        .post('/tasks')
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ room_id: roomId, title: 'Cancel task', idempotency_key: 'k33' })
        .expect(201);

      await request(ctx.app)
        .post(`/tasks/${createRes.body.id}/events`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({ status: 'cancelled', idempotency_key: 'k34' })
        .expect(201);

      const detail = await request(ctx.app)
        .get(`/tasks/${createRes.body.id}`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .expect(200);

      expect(detail.body.task.status).toBe('cancelled');
      expect(detail.body.task.cancelled_at).toBeDefined();
    });
  });
});
