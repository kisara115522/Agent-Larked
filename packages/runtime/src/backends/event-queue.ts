/**
 * Single-producer/single-consumer async queue that bridges a push-based source
 * (child_process stdout events) to a pull-based AsyncIterable (AgentBackend.run).
 *
 * Replaces multica's Go channel. push() never blocks; drain() yields buffered
 * items, then awaits the next push, until end() is called.
 */
export interface EventQueue<T> {
  push(item: T): void;
  end(): void;
  drain(): AsyncGenerator<T>;
}

export function createEventQueue<T>(): EventQueue<T> {
  const buffer: T[] = [];
  let wake: (() => void) | null = null;
  let ended = false;

  function signal(): void {
    const w = wake;
    wake = null;
    w?.();
  }

  return {
    push(item: T): void {
      if (ended) return;
      buffer.push(item);
      signal();
    },
    end(): void {
      ended = true;
      signal();
    },
    async *drain(): AsyncGenerator<T> {
      // No `await` between the buffer check and the Promise-executor assignment,
      // so a push() landing after the checks cannot be missed (JS is single-
      // threaded; the executor runs synchronously and sets `wake` before the
      // await suspends).
      while (true) {
        if (buffer.length > 0) {
          yield buffer.shift()!;
          continue;
        }
        if (ended) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
