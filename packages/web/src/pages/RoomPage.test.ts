import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendHumanRoomMessage } from './RoomPage';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ id: 'msg-1', sequence: 1, created_at: '2026-05-22T00:00:00.000Z' }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('sendHumanRoomMessage', () => {
  it('posts through the human room message endpoint', async () => {
    await sendHumanRoomMessage('human-token', 'room-1', '@Agent hello', ['agent-1']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/rooms/room-1/messages');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer human-token',
        'Content-Type': 'application/json',
      },
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      content: '@Agent hello',
      mentions: ['agent-1'],
    });
  });
});
