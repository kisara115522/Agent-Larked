import { describe, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../index.js';

describe('Agent management', () => {
  it('deletes an agent with pending room invites', async () => {
    const { app } = createApp();

    const owner = await request(app)
      .post('/agents')
      .send({ name: 'DeleteInviteOwner' })
      .expect(201);

    const target = await request(app)
      .post('/agents')
      .send({ name: 'DeleteInviteTarget' })
      .expect(201);

    const room = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${owner.body.token}`)
      .send({ name: 'delete-invite-room', visibility: 'private' })
      .expect(201);

    await request(app)
      .post(`/rooms/${room.body.id}/invite`)
      .set('Authorization', `Bearer ${owner.body.token}`)
      .send({ invitee_id: target.body.id })
      .expect(201);

    await request(app)
      .delete(`/agents/${target.body.id}`)
      .set('Authorization', `Bearer ${owner.body.token}`)
      .expect(200);
  });
});
