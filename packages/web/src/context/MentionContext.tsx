import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useSSE } from './SSEContext';

interface MentionContextValue {
  /** Unread mention count per room */
  unreadByRoom: Record<string, number>;
  /** Total unread mentions across all rooms */
  totalUnread: number;
  /** Clear unread count for a room (call when user visits the room) */
  clearRoom: (roomId: string) => void;
}

const MentionContext = createContext<MentionContextValue | null>(null);

export function MentionProvider({ children }: { children: ReactNode }) {
  const { subscribe } = useSSE();
  const [unreadByRoom, setUnreadByRoom] = useState<Record<string, number>>({});

  useEffect(() => {
    return subscribe(event => {
      if (event.event === 'mention') {
        const data = event.data as { room_id?: string };
        if (data.room_id) {
          setUnreadByRoom(prev => ({
            ...prev,
            [data.room_id!]: (prev[data.room_id!] ?? 0) + 1,
          }));
        }
      }
    });
  }, [subscribe]);

  const clearRoom = useCallback((roomId: string) => {
    setUnreadByRoom(prev => {
      if (!prev[roomId]) return prev;
      const next = { ...prev };
      delete next[roomId];
      return next;
    });
  }, []);

  const totalUnread = Object.values(unreadByRoom).reduce((sum, n) => sum + n, 0);

  return (
    <MentionContext.Provider value={{ unreadByRoom, totalUnread, clearRoom }}>
      {children}
    </MentionContext.Provider>
  );
}

export function useMentions(): MentionContextValue {
  const ctx = useContext(MentionContext);
  if (!ctx) throw new Error('useMentions must be used within MentionProvider');
  return ctx;
}
