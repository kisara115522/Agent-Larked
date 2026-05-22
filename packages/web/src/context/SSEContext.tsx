import { createContext, useContext, useEffect, useRef, useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';

type SSEEventType = 'mention' | 'reaction' | 'room_message' | 'direct_message' | 'agent_status' | 'task_created' | 'task_status' | 'task_artifact' | 'workflow_event';

interface SSEMessage {
  event: SSEEventType;
  data: unknown;
}

const SSE_EVENT_TYPES = new Set<string>([
  'mention',
  'reaction',
  'room_message',
  'direct_message',
  'agent_status',
  'task_created',
  'task_status',
  'task_artifact',
  'workflow_event',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSSEEventType(value: unknown): value is SSEEventType {
  return typeof value === 'string' && SSE_EVENT_TYPES.has(value);
}

export function parseSSEMessage(event: MessageEvent<string>): SSEMessage {
  const payload = JSON.parse(event.data) as unknown;
  const eventType = isRecord(payload) && isSSEEventType(payload.event)
    ? payload.event
    : isSSEEventType(event.type)
      ? event.type
      : 'room_message';

  return {
    event: eventType,
    data: isRecord(payload) && 'data' in payload ? payload.data : payload,
  };
}

type SSEHandler = (event: SSEMessage) => void;

interface SSEContextValue {
  subscribe: (handler: SSEHandler) => () => void;
  connected: boolean;
}

const SSEContext = createContext<SSEContextValue | null>(null);

export function SSEProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const handlersRef = useRef<Set<SSEHandler>>(new Set());
  const sourceRef = useRef<EventSource | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!token) {
      setConnected(false);
      return;
    }

    let disposed = false;

    function connect() {
      if (disposed) return;

      const source = new EventSource(`/events?token=${token}`);
      sourceRef.current = source;

      source.onopen = () => {
        if (!disposed) setConnected(true);
      };

      const handleMessage = (event: MessageEvent) => {
        try {
          const sseMessage = parseSSEMessage(event);
          for (const handler of handlersRef.current) {
            handler(sseMessage);
          }
        } catch {
          // ignore parse errors
        }
      };

      source.addEventListener('mention', handleMessage);
      source.addEventListener('reaction', handleMessage);
      source.addEventListener('room_message', handleMessage);
      source.addEventListener('direct_message', handleMessage);
      source.addEventListener('agent_status', handleMessage);
      source.addEventListener('task_created', handleMessage);
      source.addEventListener('task_status', handleMessage);
      source.addEventListener('task_artifact', handleMessage);
      source.addEventListener('workflow_event', handleMessage);
      source.onmessage = handleMessage;

      source.onerror = () => {
        if (disposed) return;
        setConnected(false);
        source.close();
        sourceRef.current = null;
        // Reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
      setConnected(false);
    };
  }, [token]);

  const subscribe = useCallback((handler: SSEHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  return (
    <SSEContext.Provider value={{ subscribe, connected }}>
      {children}
    </SSEContext.Provider>
  );
}

export function useSSE(): SSEContextValue {
  const ctx = useContext(SSEContext);
  if (!ctx) throw new Error('useSSE must be used within SSEProvider');
  return ctx;
}
