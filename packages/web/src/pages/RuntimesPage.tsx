import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { get } from '../api/client';

interface Runtime {
  id: string;
  host: string;
  port: number;
  callback_url: string;
  capabilities: string[];
  max_agents: number;
  agent_count: number;
  status: string;
  last_heartbeat_at: string | null;
  created_at: string;
}

export function RuntimesPage() {
  const { token } = useAuth();
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [showHelp, setShowHelp] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await get<{ runtimes: Runtime[] }>('/runtimes', token).catch(() => ({ runtimes: [] }));
      setRuntimes(res.runtimes);
    } catch {}
  }, [token]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-12 pt-12 pb-6 shrink-0" style={{ animation: 'fadeUp .4s ease-out' }}>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[36px] font-black tracking-tight leading-none" style={{ fontFamily: 'var(--font-display)' }}>
              Runtime
            </h1>
            <p className="text-[14px] text-text-dim mt-3 font-medium">{runtimes.length} 个 daemon 已注册</p>
          </div>
          <button
            onClick={() => setShowHelp(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-semibold bg-accent text-white hover:bg-accent-hover transition-colors duration-150"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
            注册新 Runtime
          </button>
        </div>
      </div>

      {/* Architecture */}
      <div className="px-12 pb-8">
        <div className="bg-surface border border-border rounded-[10px] p-5 max-w-[500px]">
          <div className="text-[11px] font-semibold text-text-dim uppercase tracking-[0.12em] mb-3">架构</div>
          <div className="space-y-2 text-[12px] text-text-muted font-mono">
            <div>Flock Server (REST + SSE + SQLite + MCP)</div>
            <div className="text-text-dim pl-4">↓ HTTP Callbacks (HMAC-SHA256)</div>
            <div>Runtime Daemon（自动注册，心跳保活）</div>
            <div className="text-text-dim pl-4">↓ spawn / wake / stop</div>
            <div>Agent 子进程（claude -p）</div>
          </div>
        </div>
      </div>

      {/* Runtime Cards */}
      <div className="px-12 pb-12">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {runtimes.length === 0 ? (
            <div className="col-span-2 text-center text-text-dim text-[13px] py-16">
              暂无注册的 Runtime。启动 daemon 后将自动注册。
            </div>
          ) : (
            runtimes.map((rt, i) => (
              <RuntimeCard key={rt.id} runtime={rt} index={i} />
            ))
          )}
        </div>
      </div>

      {/* Help Modal */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowHelp(false)} style={{ animation: 'fadeIn .15s ease-out' }}>
          <div className="w-[500px] p-7 bg-surface-elevated border border-border rounded-[14px] shadow-lg" onClick={e => e.stopPropagation()} style={{ animation: 'scaleIn .2s ease-out' }}>
            <h3 className="text-[18px] font-bold mb-4">注册新 Runtime</h3>
            <p className="text-[13px] text-text-muted mb-5">
              Runtime daemon 启动后会自动注册到 Flock Server。无需手动注册。
            </p>
            <div className="bg-bg-warm border border-border rounded-[6px] p-4 font-mono text-[11px] leading-relaxed mb-5">
              <div className="text-text-dim mb-2"># 在目标机器上启动 Runtime daemon</div>
              <div>CALLBACK_PORT=4000 \</div>
              <div>FLOCK_SERVER_URL=http://your-server:3001 \</div>
              <div>npx tsx packages/runtime/src/index.ts</div>
            </div>
            <div className="text-[12px] text-text-muted space-y-1.5">
              <p>• Runtime 启动后自动向 Server 注册</p>
              <p>• 心跳间隔默认 30 秒</p>
              <p>• spawn/wake 请求自动路由到可用 Runtime</p>
            </div>
            <div className="mt-6 flex justify-end">
              <button onClick={() => setShowHelp(false)} className="px-5 py-2.5 rounded-full text-[13px] font-semibold bg-accent text-white hover:bg-accent-hover transition-all active:scale-95">
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RuntimeCard({ runtime, index }: { runtime: Runtime; index: number }) {
  const isOnline = runtime.status === 'online';
  const caps = Array.isArray(runtime.capabilities) ? runtime.capabilities : [];

  const heartbeat = runtime.last_heartbeat_at
    ? `${Math.round((Date.now() - new Date(runtime.last_heartbeat_at).getTime()) / 1000)}s ago`
    : '从未';

  return (
    <div className="bg-surface border border-border rounded-[10px] p-5" style={{ animation: `fadeUp .35s ease-out ${index * 50}ms both` }}>
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-success status-dot-online' : 'bg-text-dim'}`} />
        <span className="font-mono font-semibold text-[13px]">{runtime.host}:{runtime.port}</span>
        <span className={`ml-auto px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${isOnline ? 'bg-success-muted text-success' : 'bg-surface-elevated text-text-muted'}`}>
          {isOnline ? '在线' : runtime.status}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <div><span className="text-text-dim block mb-0.5">心跳</span><span className="font-mono">{heartbeat}</span></div>
        <div><span className="text-text-dim block mb-0.5">Capabilities</span>{caps.join(', ') || 'general'}</div>
      </div>
      <div className="mt-4 pt-3 border-t border-border/50 text-[11px] flex items-center gap-2">
        <span className="text-text-dim">Agent:</span>
        <span className="font-mono font-medium">
          {runtime.agent_count} / {runtime.max_agents}
        </span>
      </div>
    </div>
  );
}
