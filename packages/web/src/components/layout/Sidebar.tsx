import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSSE } from '../../context/SSEContext';
import { useMentions } from '../../context/MentionContext';
import { useTheme } from '../../context/ThemeContext';

function hashAvatarColor(str: string): string {
  const colors = ['#2563eb', '#059669', '#d97706', '#dc2626', '#0f766e', '#4f46e5'];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return colors[Math.abs(h) % colors.length];
}

export function Sidebar() {
  const { human, logout } = useAuth();
  const { connected } = useSSE();
  const { unreadByRoom } = useMentions();
  const { mode, cycle } = useTheme();

  const totalUnread = Object.values(unreadByRoom).reduce((s, n) => s + n, 0);
  const displayName = human?.display_name || human?.username || '?';

  return (
    <aside className="h-screen w-[220px] shrink-0 border-r border-border bg-surface flex flex-col">
      <div className="px-4 py-5 border-b border-border flex items-center gap-3">
        <div className="w-9 h-9 rounded-[8px] flex items-center justify-center shrink-0 bg-accent">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="4" cy="8" r="2.5" fill="white" opacity="0.9"/>
            <circle cx="12" cy="4" r="2" fill="white" opacity="0.7"/>
            <circle cx="12" cy="12" r="2" fill="white" opacity="0.7"/>
            <line x1="6.2" y1="7.1" x2="10.2" y2="4.8" stroke="white" strokeWidth="1.2" opacity="0.5"/>
            <line x1="6.2" y1="8.9" x2="10.2" y2="11.2" stroke="white" strokeWidth="1.2" opacity="0.5"/>
          </svg>
        </div>
        <div className="min-w-0">
          <div className="text-[16px] font-bold tracking-tight leading-none">
            Flock
          </div>
          <div className="mt-1 text-[10px] text-text-dim font-semibold uppercase tracking-[0.14em]">
            Agent OS
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <NavSection label="工作区" />
        <NavIcon to="/" icon={<IcBolt />} label="工作流" desc="实时事件与运行概览" />
        <NavIcon to="/feed" icon={<IcChat />} label="Room" desc="协作消息流" badge={totalUnread > 0 ? totalUnread : undefined} />
        <NavIcon to="/agents" icon={<IcAgent />} label="Agent" desc="成员与能力" />
        <NavIcon to="/tasks" icon={<IcTask />} label="任务" desc="看板与分配" />

        <NavSection label="运行" />
        <NavIcon to="/command" icon={<IcChat />} label="私信" desc="1:1 指令通道" />
        <NavIcon to="/orchestrator" icon={<IcFlow />} label="编排" desc="任务链路" />
        <NavIcon to="/runtimes" icon={<IcServer />} label="Runtime" desc="daemon 与槽位" />
        <NavIcon to="/wake" icon={<IcBell />} label="唤醒" desc="恢复 dormant agent" />

        <NavSection label="管理" />
        <NavIcon to="/tokens" icon={<IcToken />} label="Token" desc="预算与消耗" />
        <NavIcon to="/settings" icon={<IcGear />} label="设置" desc="全局配置" />
      </nav>

      <div className="border-t border-border p-3 space-y-2">
        <button
          onClick={cycle}
          className="flex items-center gap-3 px-3 py-2 rounded-[8px] w-full text-left hover:bg-surface-elevated transition-colors"
          title={`主题: ${mode === 'system' ? '跟随系统' : mode === 'light' ? '浅色' : '深色'}`}
        >
          <span className="w-5 h-5 flex items-center justify-center shrink-0 text-text-dim">
            {mode === 'light' ? <IcSun /> : mode === 'dark' ? <IcMoon /> : <IcMonitor />}
          </span>
          <span className="text-[12px] text-text-muted font-medium">
              {mode === 'system' ? '跟随系统' : mode === 'light' ? '浅色' : '深色'}
          </span>
        </button>

        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-text-dim">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-success status-dot-online' : 'bg-text-dim'}`}
          />
          <span>{connected ? 'SSE 已连接' : 'SSE 断开'}</span>
        </div>

        {human && (
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-[8px] hover:bg-surface-elevated transition-colors cursor-default group">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
              style={{ background: hashAvatarColor(displayName) }}
            >
              {displayName.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold truncate">{displayName}</div>
                <div className="text-[10px] text-text-dim">管理员</div>
            </div>
            <button
              onClick={logout}
              className="text-text-dim hover:text-error transition-colors p-1 rounded"
              title="退出登录"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function NavSection({ label }: { label: string }) {
  return (
    <div className="px-3 pt-4 first:pt-0 pb-2 text-[10px] text-text-dim font-semibold uppercase tracking-[0.16em]">
      {label}
    </div>
  );
}

function NavIcon({ to, icon, label, desc, badge }: {
  to: string; icon: React.ReactNode; label: string; desc: string; badge?: number;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `relative flex items-center gap-3 rounded-[8px] px-3 py-2.5 mb-1 border transition-colors duration-150 ${
          isActive
            ? 'bg-accent-soft text-accent border-accent/20'
            : 'text-text-muted border-transparent hover:text-text hover:bg-surface-elevated'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span className={`w-5 h-5 flex items-center justify-center shrink-0 transition-colors ${isActive ? 'text-accent' : ''}`}>
            {icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold leading-tight">{label}</span>
            <span className={`block text-[10px] truncate mt-0.5 ${isActive ? 'text-accent/80' : 'text-text-dim'}`}>{desc}</span>
          </span>
          {badge !== undefined && badge > 0 && (
            <span className="shrink-0 bg-accent text-white text-[9px] font-bold min-w-4 h-4 px-1 rounded-full flex items-center justify-center">
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
