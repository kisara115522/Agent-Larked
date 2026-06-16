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
  let ended = false;

  return {
    push(item: T): void {
      if (ended) return;
      buffer.push(item);
    },
    end(): void {
      ended = true;
    },
    async *drain(): AsyncGenerator<T> {
      while (true) {
        if (buffer.length > 0) {
          yield buffer.shift()!;
          continue;
        }
        if (ended) return;
        // Yield control to allow more pushes to arrive (temporary busy-wait
        // placeholder — will be replaced with wake/signal in the next commit).
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    },
  };
}
