import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveRoomRules, sendHumanRoomMessage } from './RoomPage';

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

describe('saveRoomRules', () => {
  it('updates room rules through the rules endpoint', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        room_id: 'room-1',
        rules: 'Only reply when mentioned.',
        rules_version: 2,
        rules_updated_at: '2026-05-24T00:00:00.000Z',
      }),
    });

    const result = await saveRoomRules('human-token', 'room-1', 'Only reply when mentioned.');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/rooms/room-1/rules');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'PUT',
      headers: {
        Authorization: 'Bearer human-token',
        'Content-Type': 'application/json',
      },
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      rules: 'Only reply when mentioned.',
    });
    expect(result.rules_version).toBe(2);
  });
});
