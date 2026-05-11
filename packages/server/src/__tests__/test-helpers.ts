import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../index.js';
import { bootstrapDefaultAdmin } from '../db.js';
import { hashToken } from '../middleware/auth.js';

export interface TestContext {
  app: Express;
  adminToken: string;
  adminId: string;
}

/** Create app and bootstrap admin agent. Returns context with the admin agent token for test use. */
export function createTestContext(): TestContext {
  const { app, db } = createApp();
  const adminToken = bootstrapDefaultAdmin(db, hashToken)!;
  const adminRow = db.prepare('SELECT id FROM profiles WHERE name = ? AND is_admin = 1').get('kisara') as { id: string };
  return { app, adminToken, adminId: adminRow.id };
}

/** Create a room using admin token. Returns room id. */
export async function createRoomAsAdmin(app: Express, adminToken: string, name: string, visibility = 'public'): Promise<string> {
  const res = await request(app)
    .post('/admin/rooms')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name, visibility })
    .expect(201);
  return res.body.id;
}

/** Register an agent and return id + token. */
export async function registerAgent(app: Express, name: string, extra?: Record<string, unknown>): Promise<{ id: string; token: string }> {
  const res = await request(app)
    .post('/agents')
    .send({ name, ...extra })
    .expect(201);
  return { id: res.body.id, token: res.body.token };
}
