import { describe, it, expect } from 'vitest';
import { createEventQueue } from '../backends/event-queue.js';

/** Collect all values from an async generator into an array. */
async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) {
    items.push(item);
  }
  return items;
}

describe('createEventQueue', () => {
  it('drain yields items pushed before drain starts', async () => {
    const q = createEventQueue<number>();
    q.push(1);
    q.push(2);
    q.end();
    expect(await collect(q.drain())).toEqual([1, 2]);
  });

  it('drain ends when end() is called before any push', async () => {
    const q = createEventQueue<number>();
    q.end();
    expect(await collect(q.drain())).toEqual([]);
  });

  it('drain waits for push then receives item', async () => {
    const q = createEventQueue<string>();
    // Push happens asynchronously after drain starts awaiting
    setTimeout(() => {
      q.push('hello');
      q.end();
    }, 0);
    const items = await collect(q.drain());
    expect(items).toEqual(['hello']);
  });

  it('push-after-end is ignored', async () => {
    const q = createEventQueue<number>();
    q.end();
    q.push(99); // should be ignored
    expect(await collect(q.drain())).toEqual([]);
  });

  it('preserves insertion order', async () => {
    const q = createEventQueue<number>();
    q.push(1);
    q.push(2);
    q.push(3);
    q.end();
    expect(await collect(q.drain())).toEqual([1, 2, 3]);
  });

  it('drain resolves immediately when items arrive while waiting', async () => {
    const q = createEventQueue<string>();
    const drainGen = q.drain();
    const nextPromise = drainGen.next();
    // Push while the generator is suspended
    q.push('woke-up');
    const { value, done } = await nextPromise;
    expect(value).toBe('woke-up');
    expect(done).toBe(false);
    q.end();
    const finalResult = await drainGen.next();
    expect(finalResult.done).toBe(true);
  });
});
