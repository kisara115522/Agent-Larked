import express from 'express';
import { createHmac } from 'node:crypto';
import type { RuntimeConfig } from './config.js';

export interface CallbackEvent {
  type: 'spawn' | 'stop' | 'wake';
  agent_id: string;
  agent_token?: string;
  prompt?: string;
  room_id?: string;
  room_name?: string;
  sender_name?: string;
  excerpt?: string;
}

export type CallbackHandler = (event: CallbackEvent) => Promise<void>;

function verifySignature(secret: string, body: string, signature: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  return expected === signature;
}

export function createCallbackServer(
  config: RuntimeConfig,
  handler: CallbackHandler,
): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Callback endpoint: POST /agents/:agentId/callback
  app.post('/agents/:agentId/callback', async (req, res) => {
    const agentId = req.params.agentId;
    const signature = req.headers['x-flock-signature'] as string | undefined;

    // Verify HMAC if secret is set
    if (config.callbackSecret && signature) {
      const rawBody = JSON.stringify(req.body);
      if (!verifySignature(config.callbackSecret, rawBody, signature)) {
        console.error(`[callback] Invalid signature for agent ${agentId}`);
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    const event: CallbackEvent = {
      type: req.body.type,
      agent_id: agentId,
      agent_token: req.body.agent_token,
      prompt: req.body.prompt,
      room_id: req.body.room_id,
      room_name: req.body.room_name,
      sender_name: req.body.sender_name,
      excerpt: req.body.excerpt,
    };

    console.log(`[callback] Received ${event.type} for agent ${agentId}`);

    try {
      await handler(event);
      res.json({ ok: true });
    } catch (err) {
      console.error(`[callback] Handler error:`, err);
      res.status(500).json({ error: 'Handler error' });
    }
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}
