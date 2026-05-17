import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { createApp } from '../index.js';
import { bootstrapDefaultAgent } from '../db.js';
import { hashToken } from '../middleware/auth.js';
import http from 'node:http';

let app: Express;
let db: Database.Database;
let adminToken: string;
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  ({ app, db } = createApp());
  adminToken = bootstrapDefaultAgent(db, hashToken)!;
  server = app.listen(0);
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

describe('SSE Events', () => {
  it('GET /events rejects missing token', async () => {
    await request(app).get('/events').expect(401);
  });

  it('GET /events rejects invalid token', async () => {
    await request(app).get('/events?token=invalid').expect(401);
  });

  it('GET /events accepts valid token', async () => {
    const reg = await request(app).post('/agents').send({ name: 'SSEBot' }).expect(201);

    // Use raw http to avoid supertest hanging on SSE stream
    const res = await fetch(`${baseUrl}/events?token=${reg.body.token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache');

    // Close the connection
    res.body?.cancel();
  });

  it('POST /rooms/:id/subscribe returns ok', async () => {
    const reg = await request(app).post('/agents').send({ name: 'SSEBot2' }).expect(201);
    const room = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'sse-room' })
      .expect(201);

    const res = await request(app)
      .post(`/rooms/${room.body.id}/subscribe`)
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
  });

  it('POST /rooms/:id/unsubscribe returns ok', async () => {
    const reg = await request(app).post('/agents').send({ name: 'SSEBot3' }).expect(201);
    const room = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'sse-room-2' })
      .expect(201);

    await request(app)
      .post(`/rooms/${room.body.id}/subscribe`)
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);

    const res = await request(app)
      .post(`/rooms/${room.body.id}/unsubscribe`)
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
  });
});
