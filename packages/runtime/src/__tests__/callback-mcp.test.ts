import { describe, it, expect } from 'vitest';
import request from 'supertest';
import type { CallbackEvent } from '../callback-server.js';
import { createCallbackServer } from '../callback-server.js';

describe('callback-server body copy: agent_mcp_servers', () => {
  it('threads agent_mcp_servers from body into event', async () => {
    let received: CallbackEvent | undefined;
    const app = createCallbackServer(
      { callbackSecret: null } as unknown as Parameters<typeof createCallbackServer>[0],
      async (ev) => { received = ev; },
    );

    const mcpServers = [
      { name: 'echo', transport: { type: 'stdio' as const, command: 'echo' } },
    ];

    await request(app)
      .post('/agents/abc/callback')
      .send({ type: 'spawn', agent_mcp_servers: mcpServers })
      .expect(200);

    expect(received?.agent_mcp_servers).toEqual(mcpServers);
  });
});
