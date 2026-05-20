import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { createApp } from '../index.js';
import { bootstrapDefaultAgent } from '../db.js';
import { hashToken } from '../middleware/auth.js';

let app: Express;
let db: Database.Database;

describe('Human Tasks', () => {
  let humanToken: string;
  let humanId: string;
  let memberRoomId: string;
  let publicRoomId: string;

  beforeAll(async () => {
    ({ app, db } = createApp());
    bootstrapDefaultAgent(db, hashToken);

    const human = await request(app)
      .post('/human/register')
      .send({ username: 'taskhuman', password: 'password123', display_name: 'Task Human' })
      .expect(201);
    humanToken = human.body.token;
    humanId = human.body.id;

    const memberRoom = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${humanToken}`)
      .send({ name: 'human-task-member-room' })
      .expect(201);
    memberRoomId = memberRoom.body.id;

    const agent = await request(app).post('/agents').send({ name: 'TaskRoomCreator' }).expect(201);
    const publicRoom = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${agent.body.token}`)
      .send({ name: 'human-task-public-room' })
      .expect(201);
    publicRoomId = publicRoom.body.id;
  });

  it('lets a human create a task in a room they joined', async () => {
    const task = await request(app)
      .post('/tasks')
      .set('Authorization', `Bearer ${humanToken}`)
      .send({ room_id: memberRoomId, title: 'human-created task' })
      .expect(201);

    expect(task.body.created_by).toBe(humanId);
    expect(task.body.room_id).toBe(memberRoomId);
  });

  it('rejects human task creation in a public room they have not joined', async () => {
    await request(app)
      .post('/tasks')
      .set('Authorization', `Bearer ${humanToken}`)
      .send({ room_id: publicRoomId, title: 'not joined task' })
      .expect(403);
  });
});
