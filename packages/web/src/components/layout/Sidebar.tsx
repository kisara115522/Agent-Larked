import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSSE } from '../../context/SSEContext';
import { get } from '../../api/client';
import { AgentAvatar } from '../agent/AgentAvatar';
import { StatusIndicator } from '../agent/StatusIndicator';

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
  const { subscribe } = useSSE();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    if (!token) return;
    get<{ rooms: Room[] }>('/rooms', token).then(r => setRooms(r.rooms)).catch(() => {});
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
        <h1 className="text-lg font-semibold text-accent">Flock</h1>
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

        <div className="mt-4 mb-2 px-3">
          <p className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Rooms</p>
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
        {agents.slice(0, 20).map(a => (
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
            <span className="truncate">{a.display_name || a.name}</span>
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
        <span>Command Center</span>
      </NavLink>
    </aside>
  );
}
