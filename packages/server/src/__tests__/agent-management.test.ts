import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../index.js';
import { bootstrapDefaultAgent } from '../db.js';
import { hashToken } from '../middleware/auth.js';

describe('Agent management', () => {
  it('agent can update own profile', async () => {
    const { app, db } = createApp();
    const adminToken = bootstrapDefaultAgent(db, hashToken)!;

    const reg = await request(app)
      .post('/agents')
      .send({ name: 'ManageBot' })
      .expect(201);

    const res = await request(app)
      .patch(`/agents/${reg.body.id}`)
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ bio: 'Updated bio', display_name: 'Managed' })
      .expect(200);

    expect(res.body.bio).toBe('Updated bio');
    expect(res.body.display_name).toBe('Managed');
  });

  it('agent cannot update another agent', async () => {
    const { app, db } = createApp();
    const adminToken = bootstrapDefaultAgent(db, hashToken)!;

    const agent1 = await request(app)
      .post('/agents')
      .send({ name: 'Agent1' })
      .expect(201);

    const agent2 = await request(app)
      .post('/agents')
      .send({ name: 'Agent2' })
      .expect(201);

    await request(app)
      .patch(`/agents/${agent2.body.id}`)
      .set('Authorization', `Bearer ${agent1.body.token}`)
      .send({ bio: 'Hacked' })
      .expect(403);
  });
});
