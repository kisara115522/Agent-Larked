import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSSE } from '../../context/SSEContext';
import { useMentions } from '../../context/MentionContext';
import { get } from '../../api/client';
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
  const { token, human, logout } = useAuth();
  const { subscribe, connected } = useSSE();
  const { unreadByRoom } = useMentions();
  const [, setRooms] = useState<Room[]>([]);
  const [, setAgents] = useState<Agent[]>([]);
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

  useEffect(() => {
    return subscribe(event => {
      if (event.event === 'agent_status') {
        const data = event.data as { agent_id: string; status: string };
        setAgents(prev => prev.map(a => a.id === data.agent_id ? { ...a, status: data.status } : a));
      }
    });
  }, [subscribe]);

  const totalUnread = Object.values(unreadByRoom).reduce((s, n) => s + n, 0);

  return (
    <aside className="w-[220px] bg-surface border-r border-border flex flex-col h-screen shrink-0 overflow-hidden">
      {/* Header */}
      <div className="p-4 pb-3 border-b border-border">
        <h2 className="text-lg font-bold tracking-tight">Flock</h2>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2">
        <NavItem to="/" icon="⚡" label="工作流" />
        <NavItem to="/feed" icon="💬" label="Room" badge={totalUnread > 0 ? totalUnread : undefined} />
        <NavItem to="/agents" icon="🤖" label="Agent" />
        <NavItem to="/tasks" icon="📋" label="任务" />
        <NavItem to="/orchestrator" icon="🔀" label="编排" />
        <NavItem to="/runtimes" icon="🖥️" label="Runtime" />
        <NavItem to="/wake" icon="🔔" label="唤醒" />
        <NavItem to="/tokens" icon="🪙" label="Token" />
        <NavItem to="/settings" icon="⚙️" label="设置" />
      </nav>

      {/* User Info */}
      <div className="p-3 border-t border-border">
        {human && (
          <div className="flex items-center gap-2.5">
            <div className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0" style={{ background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)' }}>
              {(human.display_name || human.username || '?')[0].toUpperCase()}
            </div>
            <div>
              <div className="text-[13px] font-semibold">{human.display_name || human.username}</div>
              <div className="text-[11px] text-text-muted">管理员</div>
            </div>
            <button onClick={logout} className="ml-auto text-[11px] text-text-muted hover:text-error transition-colors" title="退出">↗</button>
          </div>
        )}
        <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-text-dim">
          <div className={`w-[5px] h-[5px] rounded-full ${connected ? 'bg-[#34D399]' : 'bg-text-dim'}`} />
          {connected ? 'SSE 已连接' : 'SSE 断开'}
        </div>
      </div>

      {/* Modals */}
      {showCreateRoom && token && <CreateRoomModal token={token} onClose={() => setShowCreateRoom(false)} onCreated={refreshRooms} />}
      {showJoinRoom && token && <JoinRoomModal token={token} onClose={() => setShowJoinRoom(false)} onJoined={refreshRooms} />}
    </aside>
  );
}

function NavItem({ to, icon, label, badge }: { to: string; icon: string; label: string; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-[13px] font-medium transition-colors mb-0.5 ${
          isActive ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text hover:bg-bg'
        }`
      }
    >
      <span className="text-base w-5 text-center">{icon}</span>
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-auto bg-accent text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  );
}
