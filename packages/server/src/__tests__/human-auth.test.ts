import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../index.js';

describe('Human Authentication (v0.5)', () => {
  let app: ReturnType<typeof createApp>['app'];

  beforeEach(() => {
    const result = createApp(':memory:');
    app = result.app;
  });

  describe('POST /human/register', () => {
    it('registers a new human user', async () => {
      const res = await request(app)
        .post('/human/register')
        .send({ username: 'kisara', password: 'password123' })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.token).toBeDefined();
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('rejects duplicate username', async () => {
      await request(app)
        .post('/human/register')
        .send({ username: 'kisara', password: 'password123' })
        .expect(201);

      await request(app)
        .post('/human/register')
        .send({ username: 'kisara', password: 'other456' })
        .expect(409);
    });

    it('rejects short username', async () => {
      await request(app)
        .post('/human/register')
        .send({ username: 'a', password: 'password123' })
        .expect(400);
    });

    it('rejects short password', async () => {
      await request(app)
        .post('/human/register')
        .send({ username: 'kisara', password: '12345' })
        .expect(400);
    });

    it('accepts display_name', async () => {
      const res = await request(app)
        .post('/human/register')
        .send({ username: 'kisara', password: 'password123', display_name: 'Kisara' })
        .expect(201);

      expect(res.body.id).toBeDefined();
    });
  });

  describe('POST /human/login', () => {
    it('logs in with correct credentials', async () => {
      await request(app)
        .post('/human/register')
        .send({ username: 'kisara', password: 'password123' });

      const res = await request(app)
        .post('/human/login')
        .send({ username: 'kisara', password: 'password123' })
        .expect(200);

      expect(res.body.id).toBeDefined();
      expect(res.body.token).toBeDefined();
    });

    it('rejects wrong password', async () => {
      await request(app)
        .post('/human/register')
        .send({ username: 'kisara', password: 'password123' });

      await request(app)
        .post('/human/login')
        .send({ username: 'kisara', password: 'wrongpassword' })
        .expect(401);
    });

    it('rejects non-existent username', async () => {
      await request(app)
        .post('/human/login')
        .send({ username: 'nobody', password: 'password123' })
        .expect(401);
    });
  });

  describe('GET /human/me', () => {
    it('returns current human info with valid session', async () => {
      const regRes = await request(app)
        .post('/human/register')
        .send({ username: 'kisara', password: 'password123', display_name: 'Kisara' });

      const res = await request(app)
        .get('/human/me')
        .set('Authorization', `Bearer ${regRes.body.token}`)
        .expect(200);

      expect(res.body.username).toBe('kisara');
      expect(res.body.display_name).toBe('Kisara');
    });

    it('rejects request without token', async () => {
      await request(app)
        .get('/human/me')
        .expect(401);
    });

    it('rejects invalid token', async () => {
      await request(app)
        .get('/human/me')
        .set('Authorization', 'Bearer invalidtoken')
        .expect(401);
    });
  });
});
