import { describe, expect, it } from 'vitest';
import { parseSSEMessage } from './SSEContext';

describe('parseSSEMessage', () => {
  it('uses the named EventSource event type for mention payloads', () => {
    const parsed = parseSSEMessage({
      type: 'mention',
      data: JSON.stringify({ message_id: 'msg-1', room_id: 'room-1' }),
    } as MessageEvent<string>);

    expect(parsed).toEqual({
      event: 'mention',
      data: { message_id: 'msg-1', room_id: 'room-1' },
    });
  });

  it('keeps the legacy onmessage wrapper format working', () => {
    const parsed = parseSSEMessage({
      type: 'message',
      data: JSON.stringify({ event: 'direct_message', data: { message_id: 'dm-1' } }),
    } as MessageEvent<string>);

    expect(parsed).toEqual({
      event: 'direct_message',
      data: { message_id: 'dm-1' },
    });
  });
});
