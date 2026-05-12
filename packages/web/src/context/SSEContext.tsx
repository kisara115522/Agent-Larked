import { createContext, useContext, useEffect, useRef, useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';

type SSEEventType = 'mention' | 'reaction' | 'room_message' | 'direct_message' | 'agent_status' | 'task_created' | 'task_status' | 'task_artifact';

interface SSEMessage {
  event: SSEEventType;
  data: unknown;
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
          const data = JSON.parse(event.data);
          const sseMessage: SSEMessage = {
            event: (data.event ?? 'room_message') as SSEEventType,
            data: data.data ?? data,
          };
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
