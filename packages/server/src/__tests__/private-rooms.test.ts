import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { createApp } from '../index.js';
import { bootstrapDefaultAgent } from '../db.js';
import { hashToken } from '../middleware/auth.js';

let app: Express;
let db: Database.Database;
let adminToken: string;

beforeAll(() => {
  ({ app, db } = createApp()); // in-memory SQLite
  adminToken = bootstrapDefaultAgent(db, hashToken)!;
});

describe('Private Rooms', () => {
  let ownerToken: string;
  let ownerId: string;
  let otherToken: string;

  beforeAll(async () => {
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

    it('rejects join for private room', async () => {
      const res = await request(app)
        .post(`/rooms/${privateRoomId}/join`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);

      expect(res.body.error.code).toBe(1303); // ROOM_IS_PRIVATE
    });
  });

  describe('Private rooms in listing', () => {
    it('non-members do not see private rooms in listing', async () => {
      await request(app)
        .post('/rooms')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'hidden-private-room', visibility: 'private' })
        .expect(201);

      const res = await request(app)
        .get('/rooms')
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(200);

      const privateRoom = res.body.rooms.find((r: { name: string }) => r.name === 'hidden-private-room');
      expect(privateRoom).toBeUndefined();
    });

    it('creator sees private rooms in listing', async () => {
      const res = await request(app)
        .get('/rooms')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const privateRoom = res.body.rooms.find((r: { name: string }) => r.name === 'hidden-private-room');
      expect(privateRoom).toBeDefined();
      expect(privateRoom.visibility).toBe('private');
    });
  });
});
