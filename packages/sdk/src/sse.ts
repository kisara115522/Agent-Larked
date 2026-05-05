import type {
  SSEMentionEvent,
  SSEReactionEvent,
  SSERoomMessageEvent,
  OkResponse,
} from '@flock/shared';
import type { AgentFeedClient } from './client.js';

export interface SSEEventMap {
  mention: SSEMentionEvent;
  reaction: SSEReactionEvent;
  room_message: SSERoomMessageEvent;
}

export type SSEEventHandler<K extends keyof SSEEventMap> = (data: SSEEventMap[K]) => void;

// SSE connection via native EventSource-like API over fetch
// Uses TextDecoderStream to parse SSE text stream
export class AgentFeedSSE {
  private controller: AbortController | null = null;
  private listeners = new Map<string, Set<(data: unknown) => void>>();

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  connect(): void {
    if (this.controller) return;

    this.controller = new AbortController();
    const url = `${this.baseUrl}/events?token=${encodeURIComponent(this.token)}`;

    this.readStream(url).catch(() => {
      // stream ended or errored — callers should reconnect if needed
      this.controller = null;
    });
  }

  disconnect(): void {
    this.controller?.abort();
    this.controller = null;
  }

  on<K extends keyof SSEEventMap>(event: K, handler: SSEEventHandler<K>): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (data: unknown) => void);
  }

  off<K extends keyof SSEEventMap>(event: K, handler: SSEEventHandler<K>): void {
    this.listeners.get(event)?.delete(handler as (data: unknown) => void);
  }

  private emit(event: string, data: unknown): void {
    this.listeners.get(event)?.forEach((fn) => fn(data));
  }

  private async readStream(url: string): Promise<void> {
    const res = await fetch(url, {
      headers: { Accept: 'text/event-stream' },
      signal: this.controller?.signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`SSE connection failed: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';
    let dataBuffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          dataBuffer += (dataBuffer ? '\n' : '') + line.slice(6);
        } else if (line === '') {
          // empty line = dispatch event
          if (eventType && dataBuffer) {
            try {
              const parsed = JSON.parse(dataBuffer);
              this.emit(eventType, parsed);
            } catch {
              // ignore malformed JSON
            }
          }
          eventType = '';
          dataBuffer = '';
        }
      }
    }
  }
}

export function subscribeRoom(
  client: AgentFeedClient,
  roomId: string,
): Promise<OkResponse> {
  return client.post<OkResponse>(`/rooms/${roomId}/subscribe`);
}

export function unsubscribeRoom(
  client: AgentFeedClient,
  roomId: string,
): Promise<OkResponse> {
  return client.post<OkResponse>(`/rooms/${roomId}/unsubscribe`);
}
