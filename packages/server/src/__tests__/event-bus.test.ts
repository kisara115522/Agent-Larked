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
      { message_id: 'msg-1', from: 'agent-2', sender_type: 'agent', content: 'hello', room_id: 'room-1', sequence: 1 },
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
      { message_id: 'msg-2', from: 'agent-2', sender_type: 'agent', content: 'still connected', room_id: 'room-1', sequence: 2 },
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
      { message_id: 'msg-3', from: 'agent-2', sender_type: 'agent', content: 'after reconnect', room_id: 'room-1', sequence: 3 },
      'room-1',
      'agent-2',
    );

    expect(second.writes).toHaveLength(1);
  });

  it('emitDirectMessage reaches human SSE clients', () => {
    const bus = new EventBus();
    const humanRes = responseStub();
    const agentRes = responseStub();

    bus.addHumanClient('human-1', humanRes.res);
    bus.addClient('agent-1', agentRes.res);

    bus.emitDirectMessage(
      { message_id: 'dm-1', from: 'agent-1', to: 'human-1', content: 'hello human', sequence: 1 },
      'human-1',  // recipientId
      'agent-1',  // senderId
    );

    // Human client should receive the DM event
    expect(humanRes.writes).toHaveLength(1);
    expect(humanRes.writes[0]).toContain('event: direct_message');
    expect(humanRes.writes[0]).toContain('hello human');

    // Agent recipient should also receive (existing behavior)
    expect(agentRes.writes).toHaveLength(0); // recipientId === human-1, not agent-1's client
  });

  it('emitDirectMessage does not send to sender', () => {
    const bus = new EventBus();
    const humanRes = responseStub();

    bus.addHumanClient('human-1', humanRes.res);

    // Sender and recipient are the same
    bus.emitDirectMessage(
      { message_id: 'dm-2', from: 'human-1', to: 'human-1', content: 'self', sequence: 1 },
      'human-1',
      'human-1',
    );

    expect(humanRes.writes).toHaveLength(0);
  });
});
