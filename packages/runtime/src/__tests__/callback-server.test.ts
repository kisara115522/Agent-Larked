import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createCallbackServer, type CallbackEvent, type CallbackHandler } from '../callback-server.js';
import type { RuntimeConfig } from '../config.js';

const baseConfig: RuntimeConfig = {
  flockServerUrl: 'http://localhost:3001',
  agentToken: 'test-token',
  callbackHost: 'localhost',
  callbackPort: 4000,
  callbackSecret: 'test-secret-123',
  maxAgents: 10,
  heartbeatIntervalMs: 30000,
  dbPath: '',
};

describe('callback-server', () => {
  it('should handle spawn callback', async () => {
    const handler: CallbackHandler = vi.fn().mockResolvedValue(undefined);
    const app = createCallbackServer(baseConfig, handler);

    const body = {
      type: 'spawn',
      prompt: 'Hello world',
    };

    // Compute valid HMAC signature
    const crypto = await import('node:crypto');
    const bodyStr = JSON.stringify(body);
    const signature = `sha256=${crypto.createHmac('sha256', 'test-secret-123').update(bodyStr).digest('hex')}`;

    const res = await request(app)
      .post('/agents/test-agent-id/callback')
      .set('X-Flock-Signature', signature)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith({
      type: 'spawn',
      agent_id: 'test-agent-id',
      prompt: 'Hello world',
    });
  });

  it('should handle stop callback', async () => {
    const handler: CallbackHandler = vi.fn().mockResolvedValue(undefined);
    const app = createCallbackServer(baseConfig, handler);

    const body = { type: 'stop' };
    const crypto = await import('node:crypto');
    const bodyStr = JSON.stringify(body);
    const signature = `sha256=${crypto.createHmac('sha256', 'test-secret-123').update(bodyStr).digest('hex')}`;

    const res = await request(app)
      .post('/agents/test-agent-id/callback')
      .set('X-Flock-Signature', signature)
      .send(body);

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledWith({
      type: 'stop',
      agent_id: 'test-agent-id',
    });
  });

  it('should handle wake callback with context', async () => {
    const handler: CallbackHandler = vi.fn().mockResolvedValue(undefined);
    const app = createCallbackServer(baseConfig, handler);

    const body = {
      type: 'wake',
      prompt: 'Check messages',
      sender_name: 'kisara',
      excerpt: 'Hey agent, wake up!',
    };
    const crypto = await import('node:crypto');
    const bodyStr = JSON.stringify(body);
    const signature = `sha256=${crypto.createHmac('sha256', 'test-secret-123').update(bodyStr).digest('hex')}`;

    const res = await request(app)
      .post('/agents/test-agent-id/callback')
      .set('X-Flock-Signature', signature)
      .send(body);

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledWith({
      type: 'wake',
      agent_id: 'test-agent-id',
      prompt: 'Check messages',
      sender_name: 'kisara',
      excerpt: 'Hey agent, wake up!',
    });
  });

  it('should reject invalid signature', async () => {
    const handler: CallbackHandler = vi.fn();
    const app = createCallbackServer(baseConfig, handler);

    const res = await request(app)
      .post('/agents/test-agent-id/callback')
      .set('X-Flock-Signature', 'sha256=invalid')
      .send({ type: 'spawn' });

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('should accept request without signature when secret is null', async () => {
    const configNoSecret = { ...baseConfig, callbackSecret: null };
    const handler: CallbackHandler = vi.fn().mockResolvedValue(undefined);
    const app = createCallbackServer(configNoSecret, handler);

    const res = await request(app)
      .post('/agents/test-agent-id/callback')
      .send({ type: 'spawn' });

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  it('should return 500 when handler throws', async () => {
    const handler: CallbackHandler = vi.fn().mockRejectedValue(new Error('handler error'));
    const app = createCallbackServer(baseConfig, handler);

    const body = { type: 'spawn' };
    const crypto = await import('node:crypto');
    const bodyStr = JSON.stringify(body);
    const signature = `sha256=${crypto.createHmac('sha256', 'test-secret-123').update(bodyStr).digest('hex')}`;

    const res = await request(app)
      .post('/agents/test-agent-id/callback')
      .set('X-Flock-Signature', signature)
      .send(body);

    expect(res.status).toBe(500);
  });

  it('should respond to health check', async () => {
    const handler: CallbackHandler = vi.fn();
    const app = createCallbackServer(baseConfig, handler);

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
