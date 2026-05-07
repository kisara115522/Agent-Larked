import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../index.js';

describe('Broadcast API', () => {
  let app: Express;
  let agent1Token: string;
  let agent1Id: string;
  let agent2Token: string;
  let agent2Id: string;

  beforeAll(async () => {
    ({ app } = createApp());

    // Register agent 1
    const res1 = await request(app)
      .post('/agents')
      .send({ name: 'broadcaster', bio: 'I broadcast' });
    agent1Token = res1.body.token;
    agent1Id = res1.body.id;

    // Register agent 2
    const res2 = await request(app)
      .post('/agents')
      .send({ name: 'follower', bio: 'I follow' });
    agent2Token = res2.body.token;
    agent2Id = res2.body.id;

    // Agent 2 follows Agent 1
    await request(app)
      .post(`/agents/${agent1Id}/follow`)
      .set('Authorization', `Bearer ${agent2Token}`);
  });

  describe('POST /broadcast', () => {
    it('should send a broadcast message', async () => {
      const res = await request(app)
        .post('/broadcast')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          content: 'Hello followers!',
          idempotency_key: 'broadcast-1',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('created_at');
    });

    it('should send a broadcast with mentions', async () => {
      const res = await request(app)
        .post('/broadcast')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          content: 'Check this out!',
          mentions: [agent2Id],
          idempotency_key: 'broadcast-2',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
    });

    it('should reject broadcast with non-existent mentions', async () => {
      const res = await request(app)
        .post('/broadcast')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          content: 'Hello!',
          mentions: ['non-existent-id'],
          idempotency_key: 'broadcast-3',
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(1001); // AGENT_NOT_FOUND
    });

    it('should reject broadcast without auth', async () => {
      const res = await request(app)
        .post('/broadcast')
        .send({ content: 'Hello!', idempotency_key: 'broadcast-4' });

      expect(res.status).toBe(401);
    });

    it('should be idempotent', async () => {
      const res1 = await request(app)
        .post('/broadcast')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          content: 'Idempotent test',
          idempotency_key: 'broadcast-idem-1',
        });

      const res2 = await request(app)
        .post('/broadcast')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          content: 'Idempotent test',
          idempotency_key: 'broadcast-idem-1',
        });

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.id).toBe(res2.body.id);
    });
  });

  describe('GET /feed', () => {
    it('should return feed from followed agents', async () => {
      // Agent 1 broadcasts
      await request(app)
        .post('/broadcast')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          content: 'Feed test message',
          idempotency_key: 'feed-1',
        });

      // Agent 2 gets feed
      const res = await request(app)
        .get('/feed')
        .set('Authorization', `Bearer ${agent2Token}`);

      expect(res.status).toBe(200);
      expect(res.body.messages).toBeInstanceOf(Array);
      expect(res.body.messages.length).toBeGreaterThan(0);
      expect(res.body.messages[0].content).toBe('Feed test message');
    });

    it('should not return own broadcasts in feed', async () => {
      // Agent 1 broadcasts
      await request(app)
        .post('/broadcast')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          content: 'My own broadcast',
          idempotency_key: 'feed-self-1',
        });

      // Agent 1 gets own feed
      const res = await request(app)
        .get('/feed')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      // Should not include own broadcasts
      const ownMessages = res.body.messages.filter(
        (m: { from: string }) => m.from === agent1Id
      );
      expect(ownMessages.length).toBe(0);
    });

    it('should support pagination', async () => {
      // Send multiple broadcasts
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/broadcast')
          .set('Authorization', `Bearer ${agent1Token}`)
          .send({
            content: `Pagination test ${i}`,
            idempotency_key: `page-${i}`,
          });
      }

      // Get first page
      const res1 = await request(app)
        .get('/feed?limit=2')
        .set('Authorization', `Bearer ${agent2Token}`);

      expect(res1.status).toBe(200);
      expect(res1.body.messages.length).toBeLessThanOrEqual(2);
      expect(res1.body.has_more).toBe(true);

      // Get second page
      if (res1.body.next_cursor) {
        const res2 = await request(app)
          .get(`/feed?limit=2&cursor=${res1.body.next_cursor}`)
          .set('Authorization', `Bearer ${agent2Token}`);

        expect(res2.status).toBe(200);
        expect(res2.body.messages.length).toBeLessThanOrEqual(2);
      }
    });

    it('should return empty feed for non-followers', async () => {
      // Register a third agent who doesn't follow anyone
      const res3 = await request(app)
        .post('/agents')
        .send({ name: 'lonely', bio: 'I follow nobody' });

      const res = await request(app)
        .get('/feed')
        .set('Authorization', `Bearer ${res3.body.token}`);

      expect(res.status).toBe(200);
      expect(res.body.messages).toEqual([]);
    });
  });
});
