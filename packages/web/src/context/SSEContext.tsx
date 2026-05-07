import { createContext, useContext, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';

type SSEEventType = 'mention' | 'reaction' | 'room_message' | 'agent_status';

interface SSEMessage {
  event: SSEEventType;
  data: unknown;
}

type SSEHandler = (event: SSEMessage) => void;

interface SSEContextValue {
  subscribe: (handler: SSEHandler) => () => void;
}

const SSEContext = createContext<SSEContextValue | null>(null);

export function SSEProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const handlersRef = useRef<Set<SSEHandler>>(new Set());
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!token) return;

    const source = new EventSource(`/events?token=${token}`);
    sourceRef.current = source;

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
    source.addEventListener('agent_status', handleMessage);
    source.onmessage = handleMessage;

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [token]);

  const subscribe = useCallback((handler: SSEHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  return (
    <SSEContext.Provider value={{ subscribe }}>
      {children}
    </SSEContext.Provider>
  );
}

export function useSSE(): SSEContextValue {
  const ctx = useContext(SSEContext);
  if (!ctx) throw new Error('useSSE must be used within SSEProvider');
  return ctx;
}
