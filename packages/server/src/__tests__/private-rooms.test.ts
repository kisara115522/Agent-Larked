import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../index.js';

let app: Express;

beforeAll(() => {
  ({ app } = createApp()); // in-memory SQLite
});

describe('Private Rooms', () => {
  let ownerToken: string;
  let ownerId: string;
  let otherToken: string;
  let otherId: string;
  let thirdToken: string;
  let thirdId: string;

  beforeAll(async () => {
    // Register 3 agents
    const reg1 = await request(app)
      .post('/agents')
      .send({ name: 'RoomOwner' })
      .expect(201);
    ownerToken = reg1.body.token;
    ownerId = reg1.body.id;

    const reg2 = await request(app)
      .post('/agents')
      .send({ name: 'OtherAgent' })
      .expect(201);
    otherToken = reg2.body.token;
    otherId = reg2.body.id;

    const reg3 = await request(app)
      .post('/agents')
      .send({ name: 'ThirdAgent' })
      .expect(201);
    thirdToken = reg3.body.token;
    thirdId = reg3.body.id;
  });

  describe('Room visibility', () => {
    it('creates a public room by default', async () => {
      const res = await request(app)
        .post('/rooms')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'public-room' })
        .expect(201);

      expect(res.body.visibility).toBe('public');
    });

    it('creates a private room with visibility=private', async () => {
      const res = await request(app)
        .post('/rooms')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'private-room', visibility: 'private' })
        .expect(201);

      expect(res.body.visibility).toBe('private');
    });

    it('GET /rooms shows visibility field', async () => {
      const res = await request(app)
        .get('/rooms')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const privateRoom = res.body.rooms.find((r: { name: string }) => r.name === 'private-room');
      expect(privateRoom).toBeDefined();
      expect(privateRoom.visibility).toBe('private');
    });
  });

  describe('Private room join restrictions', () => {
    let privateRoomId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/rooms')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'private-join-test', visibility: 'private' })
        .expect(201);
      privateRoomId = res.body.id;
    });

    it('rejects join without invite for private room', async () => {
      const res = await request(app)
        .post(`/rooms/${privateRoomId}/join`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);

      expect(res.body.error.code).toBe(1018); // ROOM_IS_PRIVATE
    });

    it('allows join with valid invite', async () => {
      // Owner invites other
      await request(app)
        .post(`/rooms/${privateRoomId}/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ invitee_id: otherId })
        .expect(201);

      // Other joins (auto-accepts invite)
      await request(app)
        .post(`/rooms/${privateRoomId}/join`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(200);

      // Verify member
      const members = await request(app)
        .get(`/rooms/${privateRoomId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(members.body.members.some((m: { id: string }) => m.id === otherId)).toBe(true);
    });
  });

  describe('Invite flow', () => {
    let roomId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/rooms')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'invite-test-room', visibility: 'private' })
        .expect(201);
      roomId = res.body.id;
    });

    it('POST /rooms/:id/invite creates an invite', async () => {
      const res = await request(app)
        .post(`/rooms/${roomId}/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ invitee_id: thirdId })
        .expect(201);

      expect(res.body.room_id).toBe(roomId);
      expect(res.body.invitee_id).toBe(thirdId);
      expect(res.body.status).toBe('pending');
    });

    it('rejects self-invite', async () => {
      const res = await request(app)
        .post(`/rooms/${roomId}/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ invitee_id: ownerId })
        .expect(400);

      expect(res.body.error.code).toBe(1019); // SELF_INVITE
    });

    it('rejects invite from non-admin', async () => {
      const res = await request(app)
        .post(`/rooms/${roomId}/invite`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ invitee_id: thirdId })
        .expect(403);

      expect(res.body.error.code).toBe(1017); // NOT_ROOM_ADMIN
    });

    it('rejects duplicate pending invite', async () => {
      // Already invited thirdId above
      const res = await request(app)
        .post(`/rooms/${roomId}/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ invitee_id: thirdId })
        .expect(409);

      expect(res.body.error.code).toBe(1016); // INVITE_ALREADY_EXISTS
    });

    it('GET /agents/me/invites lists pending invites', async () => {
      const res = await request(app)
        .get('/agents/me/invites')
        .set('Authorization', `Bearer ${thirdToken}`)
        .expect(200);

      expect(res.body.invites.length).toBeGreaterThan(0);
      const invite = res.body.invites.find((i: { room_id: string }) => i.room_id === roomId);
      expect(invite).toBeDefined();
      expect(invite.status).toBe('pending');
      expect(invite.room_name).toBe('invite-test-room');
      expect(invite.inviter_name).toBe('RoomOwner');
    });

    it('POST /invites/:id/accept accepts invite', async () => {
      // Get invite ID
      const invitesRes = await request(app)
        .get('/agents/me/invites')
        .set('Authorization', `Bearer ${thirdToken}`)
        .expect(200);

      const invite = invitesRes.body.invites.find((i: { room_id: string }) => i.room_id === roomId);
      expect(invite).toBeDefined();

      const res = await request(app)
        .post(`/invites/${invite.id}/accept`)
        .set('Authorization', `Bearer ${thirdToken}`)
        .expect(200);

      expect(res.body.ok).toBe(true);

      // Verify now a member
      const members = await request(app)
        .get(`/rooms/${roomId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(members.body.members.some((m: { id: string }) => m.id === thirdId)).toBe(true);
    });

    it('rejects accepting already-accepted invite', async () => {
      const invitesRes = await request(app)
        .get('/agents/me/invites')
        .set('Authorization', `Bearer ${thirdToken}`)
        .expect(200);

      // No more pending invites for this room
      const invite = invitesRes.body.invites.find((i: { room_id: string }) => i.room_id === roomId);
      expect(invite).toBeUndefined();
    });
  });

  describe('Invite reject flow', () => {
    let roomId: string;
    let inviteId: string;
    let rejectToken: string;

    beforeAll(async () => {
      // Create a new private room
      const res = await request(app)
        .post('/rooms')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'reject-test-room', visibility: 'private' })
        .expect(201);
      roomId = res.body.id;

      // Register a new agent for rejection test
      const reg = await request(app)
        .post('/agents')
        .send({ name: 'RejectBot' })
        .expect(201);
      rejectToken = reg.body.token;

      // Invite
      const inviteRes = await request(app)
        .post(`/rooms/${roomId}/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ invitee_id: reg.body.id })
        .expect(201);
      inviteId = inviteRes.body.id;
    });

    it('POST /invites/:id/reject rejects invite', async () => {
      const res = await request(app)
        .post(`/invites/${inviteId}/reject`)
        .set('Authorization', `Bearer ${rejectToken}`)
        .expect(200);

      expect(res.body.ok).toBe(true);
    });
  });

  describe('Private rooms in listing', () => {
    it('non-members do not see private rooms in listing', async () => {
      // Create a private room
      await request(app)
        .post('/rooms')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'hidden-private-room', visibility: 'private' })
        .expect(201);

      // Third agent lists rooms (not a member)
      const res = await request(app)
        .get('/rooms')
        .set('Authorization', `Bearer ${thirdToken}`)
        .expect(200);

      const privateRoom = res.body.rooms.find((r: { name: string }) => r.name === 'hidden-private-room');
      expect(privateRoom).toBeUndefined();
    });

    it('members see private rooms in listing', async () => {
      // Create a private room and invite other agent
      const roomRes = await request(app)
        .post('/rooms')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'visible-private-room', visibility: 'private' })
        .expect(201);

      await request(app)
        .post(`/rooms/${roomRes.body.id}/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ invitee_id: otherId })
        .expect(201);

      await request(app)
        .post(`/rooms/${roomRes.body.id}/join`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(200);

      // Other agent lists rooms
      const res = await request(app)
        .get('/rooms')
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(200);

      const privateRoom = res.body.rooms.find((r: { name: string }) => r.name === 'visible-private-room');
      expect(privateRoom).toBeDefined();
      expect(privateRoom.visibility).toBe('private');
    });
  });

  describe('Invite to already-member', () => {
    it('rejects invite to agent already in room', async () => {
      const roomRes = await request(app)
        .post('/rooms')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'already-member-room', visibility: 'private' })
        .expect(201);

      // Invite and accept
      await request(app)
        .post(`/rooms/${roomRes.body.id}/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ invitee_id: otherId })
        .expect(201);

      await request(app)
        .post(`/rooms/${roomRes.body.id}/join`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(200);

      // Try to invite again
      const res = await request(app)
        .post(`/rooms/${roomRes.body.id}/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ invitee_id: otherId })
        .expect(400);

      expect(res.body.error.message).toContain('already a member');
    });
  });
});
