import express from 'express';
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../index.js';
import { hashToken } from '../middleware/auth.js';
import { bootstrapDefaultAgent } from '../db.js';

describe('automatic wake callbacks', () => {
  it('wakes a mentioned dormant agent with identity, token, provider config, and room context', async () => {
    const { app, db } = createApp();
    const adminToken = bootstrapDefaultAgent(db, hashToken)!;
    const callbackCalls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const callbackApp = express();
    callbackApp.use(express.json());
    callbackApp.post('/agents/:id/callback', (req, res) => {
      callbackCalls.push({ path: req.path, body: req.body });
      res.json({ ok: true });
    });

    const callbackServer = callbackApp.listen(0);
    try {
      const address = callbackServer.address();
      if (!address || typeof address === 'string') {
        throw new Error('callback server did not bind to a TCP port');
      }

      const mentioned = await request(app).post('/agents').send({ name: 'MentionWakeBot' }).expect(201);
      const sender = await request(app).post('/agents').send({ name: 'MentionSender' }).expect(201);
      const runtime = await request(app)
        .post('/runtimes')
        .send({
          host: '127.0.0.1',
          port: address.port,
          callback_url: `http://127.0.0.1:${address.port}`,
          max_agents: 10,
        })
        .expect(201);

      await request(app)
        .patch('/configs')
        .set('Authorization', `Bearer ${mentioned.body.token}`)
        .send({ config_type: 'model', config_value: 'sonnet' })
        .expect(200);
      await request(app)
        .patch('/configs')
        .set('Authorization', `Bearer ${mentioned.body.token}`)
        .send({ config_type: 'provider', config_value: { name: 'custom', env: { ANTHROPIC_BASE_URL: 'https://provider.test' } } })
        .expect(200);

      const room = await request(app)
        .post('/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'mention-wake-room' })
        .expect(201);
      await request(app).post(`/rooms/${room.body.id}/join`).set('Authorization', `Bearer ${sender.body.token}`).expect(200);
      await request(app).post(`/rooms/${room.body.id}/join`).set('Authorization', `Bearer ${mentioned.body.token}`).expect(200);

      db.prepare("UPDATE profiles SET status = 'dormant' WHERE id = ?").run(mentioned.body.id);
      db.prepare(`
        INSERT INTO agent_spawns (id, agent_id, runtime_id, status, spawned_at, last_active_at, prompt)
        VALUES ('mention-wake-previous-spawn', ?, ?, 'stopped', ?, ?, 'previous spawn')
      `).run(mentioned.body.id, runtime.body.id, new Date().toISOString(), new Date().toISOString());

      await request(app)
        .post('/messages')
        .set('Authorization', `Bearer ${sender.body.token}`)
        .send({
          room_id: room.body.id,
          content: '@MentionWakeBot please use the room context',
          mentions: [mentioned.body.id],
          idempotency_key: 'mention-wake-context',
        })
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(callbackCalls).toHaveLength(1);
      expect(callbackCalls[0].body).toMatchObject({
        type: 'wake',
        trigger_type: 'mention',
        agent_name: 'MentionWakeBot',
        agent_model: 'sonnet',
        room_id: room.body.id,
        room_name: 'mention-wake-room',
      });
      expect(callbackCalls[0].body.agent_token).toEqual(expect.any(String));
      expect(callbackCalls[0].body.agent_provider).toMatchObject({ name: 'custom' });
      expect(String(callbackCalls[0].body.prompt)).toContain('@MentionWakeBot please use the room context');

      const activeSpawn = db.prepare(`
        SELECT status, prompt FROM agent_spawns
        WHERE agent_id = ? AND runtime_id = ?
        ORDER BY spawned_at DESC
        LIMIT 1
      `).get(mentioned.body.id, runtime.body.id) as { status: string; prompt: string };
      expect(activeSpawn.status).toBe('spawning');
      expect(activeSpawn.prompt).toContain('mention-wake-room');

      await request(app)
        .post(`/agents/${mentioned.body.id}/activity`)
        .set('Authorization', `Bearer ${callbackCalls[0].body.agent_token}`)
        .send({ activity_type: 'status_change', detail: 'Agent active', metadata: { session_id: 'mention-session' } })
        .expect(201);
    } finally {
      await new Promise<void>((resolve) => callbackServer.close(() => resolve()));
    }
  });
});
