import { describe, expect, it } from 'vitest';
import type { Response } from 'express';
import { EventBus } from '../sse/event-bus.js';

function responseStub(): { writes: string[]; isEnded: () => boolean; res: Response; close: () => void } {
  let closeHandler: (() => void) | null = null;
  const writes: string[] = [];
  const state: { writes: string[]; ended: boolean; res: { write: (chunk: string) => void; end: () => void; on: (event: string, cb: () => void) => void }; close: () => void; isEnded: () => boolean } = {
    writes,
    ended: false,
    res: {
      write: (chunk: string): void => {
        writes.push(chunk);
      },
      end: (): void => {
        state.ended = true;
      },
      on: (event: string, cb: () => void): void => {
        if (event === 'close') closeHandler = cb;
      },
    },
    close: (): void => {
      closeHandler?.();
    },
    isEnded: (): boolean => state.ended,
  };
  return { ...state, res: state.res as unknown as Response };
}

describe('EventBus', () => {
  it('keeps room subscriptions when an SSE connection reconnects', () => {
    const bus = new EventBus();
    const first = responseStub();
    const second = responseStub();

    bus.addClient('agent-1', first.res);
    bus.subscribe('agent-1', 'room-1');
    bus.addClient('agent-1', second.res);

    expect(first.isEnded()).toBe(true);

    bus.emitRoomMessage(
      { message_id: 'msg-1', from: 'agent-2', content: 'hello', room_id: 'room-1', sequence: 1 },
      'room-1',
      'agent-2',
    );

    expect(second.writes).toHaveLength(1);
    expect(second.writes[0]).toContain('event: room_message');
  });

  it('does not let the old connection close remove a newer connection', () => {
    const bus = new EventBus();
    const first = responseStub();
    const second = responseStub();

    bus.addClient('agent-1', first.res);
    bus.subscribe('agent-1', 'room-1');
    bus.addClient('agent-1', second.res);
    first.close();

    bus.emitRoomMessage(
      { message_id: 'msg-2', from: 'agent-2', content: 'still connected', room_id: 'room-1', sequence: 2 },
      'room-1',
      'agent-2',
    );

    expect(second.writes).toHaveLength(1);
  });

  it('preserves explicit room subscriptions across SSE disconnect and reconnect', () => {
    const bus = new EventBus();
    const first = responseStub();
    const second = responseStub();

    bus.addClient('agent-1', first.res);
    bus.subscribe('agent-1', 'room-1');
    first.close();
    bus.addClient('agent-1', second.res);

    bus.emitRoomMessage(
      { message_id: 'msg-3', from: 'agent-2', content: 'after reconnect', room_id: 'room-1', sequence: 3 },
      'room-1',
      'agent-2',
    );

    expect(second.writes).toHaveLength(1);
  });
});
