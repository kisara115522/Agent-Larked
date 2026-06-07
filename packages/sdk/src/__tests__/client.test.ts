import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentFeedClient, AgentFeedError } from '../client.js';
import { register, updateProfile } from '../identity.js';
import { discover } from '../discovery.js';
import { createRoom, joinRoom, leaveRoom } from '../room.js';
import { sendMessage, getMessages } from '../messaging.js';
import { sendDirectMessage, getDirectMessages, listDirectChats } from '../direct-chat.js';
import { react, getThread } from '../reaction.js';
import { subscribeRoom, unsubscribeRoom } from '../sse.js';
import { getTask as getTaskDetail } from '../task.js';
import { ErrorCode } from '@flock/shared';

const BASE = 'http://localhost:3000';

function mockFetch(response: unknown, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(response),
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function mockFetchSequence(responses: unknown[]) {
  const fn = vi.fn();
  for (const response of responses) {
    fn.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(response),
    });
  }
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('AgentFeedClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sets Authorization header when token is set', async () => {
    const fetchFn = mockFetch({ ok: true });
    const client = new AgentFeedClient({ baseUrl: BASE, token: 'abc' });
    await client.get('/test');

    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/test`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer abc',
        }),
      }),
    );
  });

  it('throws AgentFeedError on non-OK response with error body', async () => {
    mockFetch(
      { error: { code: 1100, message: 'Agent not found', retryable: false } },
      404,
    );
    const client = new AgentFeedClient({ baseUrl: BASE });

    await expect(client.get('/test')).rejects.toThrow(AgentFeedError);
    try {
      await client.get('/test');
    } catch (e) {
      expect(e).toBeInstanceOf(AgentFeedError);
      const err = e as AgentFeedError;
      expect(err.code).toBe(ErrorCode.AGENT_NOT_FOUND);
      expect(err.status).toBe(404);
    }
  });
});

describe('Identity', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('register sends POST /agents', async () => {
    const fetchFn = mockFetch({ id: 'a1', name: 'Bot', token: 'tok123' });
    const client = new AgentFeedClient({ baseUrl: BASE });
    const res = await register(client, { name: 'Bot', capabilities: ['code-review'] });

    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/agents`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(res.id).toBe('a1');
    expect(res.token).toBe('tok123');
  });

  it('updateProfile sends PATCH /agents/:id', async () => {
    const fetchFn = mockFetch({ id: 'a1', name: 'Bot', status: 'active' });
    const client = new AgentFeedClient({ baseUrl: BASE, token: 'tok' });
    await updateProfile(client, 'a1', { status: 'active' });

    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/agents/a1`,
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});

describe('Discovery', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('discover sends GET /agents with query params', async () => {
    const fetchFn = mockFetch({ agents: [], has_more: false });
    const client = new AgentFeedClient({ baseUrl: BASE, token: 'tok' });
    await discover(client, { q: 'review', capabilities: 'code-review', status: 'active' });

    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toContain('/agents?');
    expect(url).toContain('q=review');
    expect(url).toContain('capabilities=code-review');
    expect(url).toContain('status=active');
  });
});

describe('Room', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('createRoom sends POST /rooms', async () => {
    const fetchFn = mockFetch({ id: 'r1', name: 'test-room' });
    const client = new AgentFeedClient({ baseUrl: BASE, token: 'tok' });
    const room = await createRoom(client, { name: 'test-room' });

    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/rooms`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(room.id).toBe('r1');
  });

  it('joinRoom sends POST /rooms/:id/join', async () => {
    const fetchFn = mockFetch({ ok: true });
    const client = new AgentFeedClient({ baseUrl: BASE, token: 'tok' });
    await joinRoom(client, 'r1');

    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/rooms/r1/join`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('leaveRoom sends POST /rooms/:id/leave', async () => {
    const fetchFn = mockFetch({ ok: true });
    const client = new AgentFeedClient({ baseUrl: BASE, token: 'tok' });
    await leaveRoom(client, 'r1');

    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/rooms/r1/leave`,
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('Messaging', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sendMessage sends POST /messages', async () => {
    const fetchFn = mockFetch({ id: 'm1', sequence: 1, created_at: '2026-05-05T00:00:00Z' });
    const client = new AgentFeedClient({ baseUrl: BASE, token: 'tok' });
    const res = await sendMessage(client, {
      room_id: 'r1',
      content: 'hello',
      idempotency_key: 'key1',
    });

    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/messages`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(res.id).toBe('m1');
    expect(res.sequence).toBe(1);
  });

  it('getMessages sends GET /rooms/:id/messages with pagination', async () => {
    const fetchFn = mockFetch({ messages: [], has_more: false });
    const client = new AgentFeedClient({ baseUrl: BASE, token: 'tok' });
    await getMessages(client, 'r1', { limit: 10, cursor: 5 });

    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toContain('/rooms/r1/messages?');
    expect(url).toContain('limit=10');
    expect(url).toContain('cursor=5');
  });
});

describe('Direct Chat', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sendDirectMessage sends POST /direct-chats/:agentId/messages', async () => {
    const fetchFn = mockFetch({ id: 'dm1', sequence: 1, created_at: '2026-05-09T00:00:00Z' }, 201);
    const client = new AgentFeedClient({ baseUrl: BASE, token: 'tok' });

    const res = await sendDirectMessage(client, 'agent-2', {
      content: 'hello privately',
      idempotency_key: 'dm-key',
    });

    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/direct-chats/agent-2/messages`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(res.id).toBe('dm1');
  });

  it('getDirectMessages sends GET /direct-chats/:agentId/messages with pagination', async () => {
    const fetchFn = mockFetch({ messages: [], next_cursor: null, has_more: false });
    const client = new AgentFeedClient({ baseUrl: BASE, token: 'tok' });

    await getDirectMessages(client, 'agent-2', { limit: 10, cursor: 3 });

    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toContain('/direct-chats/agent-2/messages?');
    expect(url).toContain('limit=10');
    expect(url).toContain('cursor=3');
  });

  it('listDirectChats sends GET /direct-chats', async () => {
    const fetchFn = mockFetch({ chats: [] });
    const client = new AgentFeedClient({ baseUrl: BASE, token: 'tok' });

    await listDirectChats(client);

    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/direct-chats`,
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('Reaction + Thread', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('react sends POST /messages/:id/reactions', async () => {
    const fetchFn = mockFetch({ id: 'rc1', type: 'useful' });
    const client = new AgentFeedClient({ baseUrl: BASE, token: 'tok' });
    await react(client, 'm1', { type: 'useful' });

    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/messages/m1/reactions`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('getThread sends GET /messages/:id/thread', async () => {
    const fetchFn = mockFetch({ messages: [] });
    const client = new AgentFeedClient({ baseUrl: BASE, token: 'tok' });
    await getThread(client, 'm1');

    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/messages/m1/thread`,
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('Subscribe', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('subscribeRoom sends POST /rooms/:id/subscribe', async () => {
    const fetchFn = mockFetch({ ok: true });
    const client = new AgentFeedClient({ baseUrl: BASE, token: 'tok' });
    await subscribeRoom(client, 'r1');

    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/rooms/r1/subscribe`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('unsubscribeRoom sends POST /rooms/:id/unsubscribe', async () => {
    const fetchFn = mockFetch({ ok: true });
    const client = new AgentFeedClient({ baseUrl: BASE, token: 'tok' });
    await unsubscribeRoom(client, 'r1');

    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/rooms/r1/unsubscribe`,
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('Task', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('getTask includes artifacts from the task artifact endpoint', async () => {
    const fetchFn = mockFetchSequence([
      {
        id: 'task-1',
        room_id: 'room-1',
        parent_task_id: null,
        title: 'Write report',
        description: '',
        status: 'todo',
        assigned_to: null,
        required_capabilities: [],
        priority: 0,
        retry_count: 0,
        max_retries: 2,
        message_id: null,
        orchestrator_id: null,
        created_by: 'agent-1',
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
        completed_at: null,
      },
      { events: [] },
      {
        artifacts: [{
          id: 'artifact-1',
          task_id: 'task-1',
          agent_id: 'agent-1',
          name: 'report.json',
          path: '/tmp/report.json',
          content_type: 'application/json',
          size: 42,
          created_at: '2026-06-01T00:01:00.000Z',
        }],
      },
    ]);
    const client = new AgentFeedClient({ baseUrl: BASE, token: 'tok' });

    const result = await getTaskDetail(client, 'task-1');

    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/tasks/task-1/artifacts`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.artifacts).toEqual([
      {
        id: 'artifact-1',
        type: 'json',
        name: 'report.json',
        created_at: '2026-06-01T00:01:00.000Z',
      },
    ]);
  });
});
