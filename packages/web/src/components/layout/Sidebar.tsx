import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSSE } from '../../context/SSEContext';
import { useMentions } from '../../context/MentionContext';
import { useTheme } from '../../context/ThemeContext';

function hashGradient(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  const hue1 = Math.abs(h) % 360;
  const hue2 = (hue1 + 47) % 360;
  return `linear-gradient(135deg, hsl(${hue1},55%,55%), hsl(${hue2},55%,40%))`;
}

export function Sidebar() {
  const { human, logout } = useAuth();
  const { connected } = useSSE();
  const { unreadByRoom } = useMentions();
  const { mode, cycle } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const totalUnread = Object.values(unreadByRoom).reduce((s, n) => s + n, 0);
  const displayName = human?.display_name || human?.username || '?';

  return (
    <aside
      className={`h-screen flex flex-col items-center py-4 shrink-0 transition-all duration-300 ease-out ${
        expanded ? 'w-[200px]' : 'w-[72px]'
      }`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* Logo */}
      <div className="mb-6 flex items-center gap-2.5 px-3 w-full justify-center">
        <div className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 bg-accent">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="4" cy="8" r="2.5" fill="white" opacity="0.9"/>
            <circle cx="12" cy="4" r="2" fill="white" opacity="0.7"/>
            <circle cx="12" cy="12" r="2" fill="white" opacity="0.7"/>
            <line x1="6.2" y1="7.1" x2="10.2" y2="4.8" stroke="white" strokeWidth="1.2" opacity="0.5"/>
            <line x1="6.2" y1="8.9" x2="10.2" y2="11.2" stroke="white" strokeWidth="1.2" opacity="0.5"/>
          </svg>
        </div>
        {expanded && (
          <span className="text-[16px] font-bold tracking-tight whitespace-nowrap" style={{ animation: 'fadeIn .15s ease-out' }}>
            Flock
          </span>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 flex flex-col gap-1 w-full px-2 overflow-y-auto">
        <NavIcon to="/" icon={<IcBolt />} label="工作流" expanded={expanded} />
        <NavIcon to="/feed" icon={<IcChat />} label="Room" expanded={expanded} badge={totalUnread > 0 ? totalUnread : undefined} />
        <NavIcon to="/agents" icon={<IcAgent />} label="Agent" expanded={expanded} />
        <NavIcon to="/tasks" icon={<IcTask />} label="任务" expanded={expanded} />

        <div className="my-3 mx-3 h-px bg-border" />

        <NavIcon to="/orchestrator" icon={<IcFlow />} label="编排" expanded={expanded} />
        <NavIcon to="/runtimes" icon={<IcServer />} label="Runtime" expanded={expanded} />
        <NavIcon to="/wake" icon={<IcBell />} label="唤醒" expanded={expanded} />
        <NavIcon to="/tokens" icon={<IcToken />} label="Token" expanded={expanded} />
        <NavIcon to="/settings" icon={<IcGear />} label="设置" expanded={expanded} />
      </nav>

      {/* Footer */}
      <div className="w-full px-2 pt-3 space-y-2">
        {/* Theme toggle */}
        <button
          onClick={cycle}
          className={`flex items-center gap-2 px-3 py-2 rounded-[10px] w-full hover:bg-surface-elevated transition-colors ${expanded ? 'justify-start' : 'justify-center'}`}
          title={`主题: ${mode === 'system' ? '跟随系统' : mode === 'light' ? '浅色' : '深色'}`}
        >
          <span className="w-5 h-5 flex items-center justify-center shrink-0 text-text-dim">
            {mode === 'light' ? <IcSun /> : mode === 'dark' ? <IcMoon /> : <IcMonitor />}
          </span>
          {expanded && (
            <span className="text-[11px] text-text-dim font-medium whitespace-nowrap" style={{ animation: 'fadeIn .1s ease-out' }}>
              {mode === 'system' ? '跟随系统' : mode === 'light' ? '浅色' : '深色'}
            </span>
          )}
        </button>

        {/* Connection indicator */}
        <div className={`flex items-center gap-2 px-3 py-1.5 justify-center ${expanded ? 'justify-start' : ''}`}>
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-success status-dot-online' : 'bg-text-dim'}`}
          />
          {expanded && <span className="text-[11px] text-text-dim">{connected ? '已连接' : '断开'}</span>}
        </div>

        {/* User avatar */}
        {human && (
          <div className={`flex items-center gap-2.5 px-2 py-2 rounded-[10px] hover:bg-surface-elevated transition-colors cursor-default group ${expanded ? '' : 'justify-center'}`}>
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
              style={{ background: hashGradient(displayName) }}
            >
              {displayName.slice(0, 2).toUpperCase()}
            </div>
            {expanded && (
              <div className="flex-1 min-w-0" style={{ animation: 'fadeIn .15s ease-out' }}>
                <div className="text-[12px] font-semibold truncate">{displayName}</div>
                <div className="text-[10px] text-text-dim">管理员</div>
              </div>
            )}
            {expanded && (
              <button
                onClick={logout}
                className="opacity-0 group-hover:opacity-100 text-text-dim hover:text-error transition-all p-1 rounded"
                title="退出登录"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function NavIcon({ to, icon, label, expanded, badge }: {
  to: string; icon: React.ReactNode; label: string; expanded: boolean; badge?: number;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `relative flex items-center gap-3 rounded-[10px] transition-all duration-200 ${
          expanded ? 'px-3 py-2.5' : 'px-0 py-2.5 justify-center'
        } ${
          isActive
            ? 'bg-accent-muted text-accent'
            : 'text-text-muted hover:text-text hover:bg-surface-elevated'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span className={`w-5 h-5 flex items-center justify-center shrink-0 transition-colors ${isActive ? 'text-accent' : ''}`}>
            {icon}
          </span>
          {expanded && (
            <span className="text-[13px] font-medium whitespace-nowrap" style={{ animation: 'fadeIn .1s ease-out' }}>
              {label}
            </span>
          )}
          {badge !== undefined && badge > 0 && (
            <span className={`absolute ${expanded ? 'right-2' : '-top-0.5 -right-0.5'} bg-accent text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center`}>
              {badge > 9 ? '9+' : badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function IcBolt() { return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><path d="M9 2L4 9h4l-1 5 5-7H8l1-5z"/></svg>; }
function IcChat() { return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><path d="M14 10a2 2 0 0 1-2 2H5l-3 2V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6z"/></svg>; }
function IcAgent() { return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>; }
function IcTask() { return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 8l2 2 4-4"/></svg>; }
function IcFlow() { return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><circle cx="3" cy="8" r="1.5"/><circle cx="13" cy="4" r="1.5"/><circle cx="13" cy="12" r="1.5"/><path d="M4.5 8h3l2-4h1M4.5 8h3l2 4h1"/></svg>; }
function IcServer() { return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><rect x="2" y="2" width="12" height="5" rx="1.5"/><rect x="2" y="9" width="12" height="5" rx="1.5"/><circle cx="12" cy="4.5" r=".8" fill="currentColor" stroke="none"/><circle cx="12" cy="11.5" r=".8" fill="currentColor" stroke="none"/></svg>; }
function IcBell() { return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><path d="M8 2a5 5 0 0 1 5 5v3l1 1H2l1-1V7a5 5 0 0 1 5-5z"/><path d="M6.5 13a1.5 1.5 0 0 0 3 0"/></svg>; }
function IcToken() { return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><circle cx="8" cy="8" r="6"/><path d="M6 8h4M8 6v4"/></svg>; }
function IcGear() { return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4"/></svg>; }
function IcSun() { return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4"/></svg>; }
function IcMoon() { return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><path d="M13.5 8.5a5.5 5.5 0 1 1-6-6 4.5 4.5 0 0 0 6 6z"/></svg>; }
function IcMonitor() { return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><rect x="2" y="2" width="12" height="9" rx="1.5"/><path d="M5 14h6M8 11v3"/></svg>; }
