import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoom } from './CreateRoomModal';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      id: 'room-1',
      name: 'planning',
      rules: 'Only answer after sync.',
      rules_version: 1,
    }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('createRoom', () => {
  it('sends optional room rules when creating a room', async () => {
    await createRoom('human-token', ' planning ', ' team room ', ' Only answer after sync. ', 'private');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/rooms');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer human-token',
        'Content-Type': 'application/json',
      },
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      name: 'planning',
      description: 'team room',
      rules: 'Only answer after sync.',
      visibility: 'private',
    });
  });
});
