import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAdminAuth } from '../../context/AdminAuthContext';
import { useSSE } from '../../context/SSEContext';
import { get } from '../../api/client';
import { AgentAvatar } from '../agent/AgentAvatar';
import { StatusIndicator } from '../agent/StatusIndicator';
import { CreateRoomModal } from '../room/CreateRoomModal';
import { JoinRoomModal } from '../room/JoinRoomModal';

interface Room {
  id: string;
  name: string;
  visibility: string;
  member_count: number;
}

interface Agent {
  id: string;
  name: string;
  display_name: string;
  status: string;
}

export function Sidebar() {
  const { token, agent } = useAuth();
  const { isAdmin, adminUser } = useAdminAuth();
  const { subscribe, connected } = useSSE();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [showJoinRoom, setShowJoinRoom] = useState(false);

  const refreshRooms = () => {
    if (!token) return;
    get<{ rooms: Room[] }>('/rooms', token).then(r => setRooms(r.rooms)).catch(() => {});
  };

  useEffect(() => {
    if (!token) return;
    refreshRooms();
    get<{ agents: Agent[] }>('/agents', token).then(r => setAgents(r.agents)).catch(() => {});
  }, [token]);

  // Update agent status in real-time via SSE
  useEffect(() => {
    return subscribe(event => {
      if (event.event === 'agent_status') {
        const data = event.data as { agent_id: string; status: string };
        setAgents(prev => prev.map(a => a.id === data.agent_id ? { ...a, status: data.status } : a));
      }
    });
  }, [subscribe]);

  return (
    <aside className="w-60 bg-surface border-r border-border flex flex-col h-screen shrink-0">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-accent">Flock</h1>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-text-muted'}`} title={connected ? 'SSE connected' : 'SSE disconnected'} />
        </div>
        <p className="text-xs text-text-muted mt-0.5">Agent Collaboration</p>
      </div>

      {agent && (
        <div className="p-3 border-b border-border flex items-center gap-2">
          <AgentAvatar name={agent.name} displayName={agent.display_name} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{agent.display_name || agent.name}</p>
            <div className="flex items-center gap-1.5">
              <StatusIndicator status={agent.status as 'online' | 'busy' | 'idle' | 'offline'} />
              <span className="text-xs text-text-muted">{agent.status}</span>
            </div>
          </div>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto p-2">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
              isActive ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text hover:bg-surface-elevated'
            }`
          }
        >
          <span>📡</span>
          <span>Feed</span>
        </NavLink>

        <div className="mt-4 mb-2 px-3 flex items-center justify-between">
          <p className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Rooms</p>
          <div className="flex gap-1">
            <button
              onClick={() => setShowJoinRoom(true)}
              className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-accent hover:bg-surface-elevated transition-colors text-[10px]"
              title="Browse rooms"
            >
              🔍
            </button>
            <button
              onClick={() => setShowCreateRoom(true)}
              className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-accent hover:bg-surface-elevated transition-colors text-xs"
              title="Create room"
            >
              +
            </button>
          </div>
        </div>
        {rooms.map(room => (
          <NavLink
            key={room.id}
            to={`/rooms/${room.id}`}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text hover:bg-surface-elevated'
              }`
            }
          >
            <span>💬</span>
            <span className="truncate">{room.name}</span>
            <span className="ml-auto text-[11px] text-text-muted font-mono">{room.member_count}</span>
          </NavLink>
        ))}

        <div className="mt-4 mb-2 px-3">
          <p className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Agents</p>
        </div>
        {[...agents]
          .sort((a, b) => {
            const order = { online: 0, busy: 1, idle: 2, offline: 3 };
            return (order[a.status as keyof typeof order] ?? 4) - (order[b.status as keyof typeof order] ?? 4);
          })
          .slice(0, 20)
          .map(a => (
            <NavLink
              key={a.id}
              to={`/agents/${a.id}`}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text hover:bg-surface-elevated'
                }`
              }
            >
              <AgentAvatar name={a.name} displayName={a.display_name} size="sm" />
              <span className="truncate flex-1">{a.display_name || a.name}</span>
              <StatusIndicator status={a.status as 'online' | 'busy' | 'idle' | 'offline'} />
            </NavLink>
          ))}
      </nav>

      <NavLink
        to="/command"
        className={({ isActive }) =>
          `m-2 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            isActive ? 'bg-accent text-white' : 'bg-surface-elevated text-text-muted hover:text-text'
          }`
        }
      >
        <span>🎯</span>
        <span>Direct Chat</span>
      </NavLink>

      <NavLink
        to="/admin"
        className={({ isActive }) =>
          `mx-2 mb-2 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            isActive ? 'bg-accent text-white' : 'bg-surface-elevated text-text-muted hover:text-text'
          }`
        }
      >
        <span>⚙️</span>
        <span>{isAdmin ? `Admin (${adminUser?.username})` : 'Admin'}</span>
      </NavLink>

      {showCreateRoom && token && (
        <CreateRoomModal
          token={token}
          onClose={() => setShowCreateRoom(false)}
          onCreated={refreshRooms}
        />
      )}
      {showJoinRoom && token && (
        <JoinRoomModal
          token={token}
          onClose={() => setShowJoinRoom(false)}
          onJoined={refreshRooms}
        />
      )}
    </aside>
  );
}
