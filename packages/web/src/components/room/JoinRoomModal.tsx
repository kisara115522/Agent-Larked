import { useState, useEffect } from 'react';
import { get, post } from '../../api/client';

interface Room {
  id: string;
  name: string;
  description: string;
  member_count: number;
  visibility: string;
}

interface JoinRoomModalProps {
  token: string;
  onClose: () => void;
  onJoined: () => void;
}

export function JoinRoomModal({ token, onClose, onJoined }: JoinRoomModalProps) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    get<{ rooms: Room[] }>('/rooms?limit=50', token)
      .then(r => setRooms(r.rooms))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const handleJoin = async (roomId: string) => {
    setJoining(roomId);
    try {
      await post(`/rooms/${roomId}/join`, token);
      onJoined();
      onClose();
    } catch {
      // ignore
    } finally {
      setJoining(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface border border-border rounded-lg shadow-xl w-96 max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border shrink-0">
          <h3 className="text-sm font-semibold">Join Room</h3>
          <p className="text-xs text-text-muted mt-0.5">Browse public rooms</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-sm text-text-muted">Loading...</div>
          ) : rooms.length === 0 ? (
            <div className="p-4 text-center text-sm text-text-muted">No rooms available</div>
          ) : (
            <div className="divide-y divide-border">
              {rooms.map(room => (
                <div key={room.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{room.name}</p>
                    {room.description && (
                      <p className="text-xs text-text-muted truncate mt-0.5">{room.description}</p>
                    )}
                    <p className="text-[11px] text-text-muted mt-0.5">{room.member_count} members</p>
                  </div>
                  <button
                    onClick={() => handleJoin(room.id)}
                    disabled={joining === room.id}
                    className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0"
                  >
                    {joining === room.id ? '...' : 'Join'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="w-full px-3 py-2 text-sm text-text-muted rounded-lg hover:bg-surface-elevated transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
