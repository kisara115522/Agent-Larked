import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { get } from '../api/client';

interface Runtime {
  id: string;
  host: string;
  port: number;
  callback_url: string;
  capabilities: string;
  max_agents: number;
  status: string;
  last_heartbeat_at: string | null;
  created_at: string;
}

export function RuntimesPage() {
  const { token } = useAuth();
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await get<{ runtimes: Runtime[] }>('/runtimes', token).catch(() => ({ runtimes: [] }));
      setRuntimes(res.runtimes);
    } catch {}
  }, [token]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-border flex items-center gap-3 shrink-0 bg-surface min-h-[56px]">
        <h3 className="text-base font-semibold">Runtime 管理</h3>
        <div className="ml-auto">
          <button className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[13px] font-semibold bg-accent text-white hover:bg-accent-hover transition-colors">
            + 注册新 Runtime
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Architecture Diagram */}
        <div className="p-6 text-center">
          <pre className="inline-block text-left font-mono text-xs leading-[1.4] text-text-muted bg-surface border border-border rounded-[10px] p-5">
{`┌────────────────────────────────────────────────────┐
│            Flock Server (localhost:3001)              │
│       REST API + SSE + SQLite + MCP Server         │
└───────────────────────┬────────────────────────────┘
                        │ HTTP Callbacks (HMAC-SHA256)
           ┌────────────┴────────────┐
           ↓                         ↓
┌───────────────────┐    ┌───────────────────┐
│ Runtime A          │    │ Runtime B          │
│ localhost:9400     │    │ (未注册)           │
│ ┌─────────┐        │    │                   │
│ │ (空)    │        │    │                   │
│ └─────────┘        │    │                   │
│ Agents: 0/10       │    └───────────────────┘
└───────────────────┘`}
          </pre>
        </div>

        {/* Runtime Cards */}
        <div className="grid grid-cols-2 gap-3 px-6 pb-6">
          {runtimes.length === 0 ? (
            <div className="col-span-2 text-center text-text-dim text-sm py-8">
              暂无注册的 Runtime。Runtime daemon 启动后将自动注册。
            </div>
          ) : (
            runtimes.map(rt => (
              <RuntimeCard key={rt.id} runtime={rt} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function RuntimeCard({ runtime }: { runtime: Runtime }) {
  const isOnline = runtime.status === 'online';
  const caps = (() => {
    try { return JSON.parse(runtime.capabilities); } catch { return []; }
  })();

  const heartbeat = runtime.last_heartbeat_at
    ? `${Math.round((Date.now() - new Date(runtime.last_heartbeat_at).getTime()) / 1000)} 秒前`
    : '从未';

  return (
    <div className="bg-surface border border-border rounded-[10px] p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-[#34D399] shadow-[0_0_8px_rgba(52,211,153,.5)]' : 'bg-text-dim'}`} />
        <span className="font-mono font-semibold text-sm">{runtime.host}:{runtime.port}</span>
        <span className={`ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${isOnline ? 'bg-[#064E3B] text-[#34D399]' : 'bg-surface-elevated text-text-muted border border-border'}`}>
          {isOnline ? '在线' : runtime.status}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div><span className="text-text-dim block">Host</span><span className="font-mono">{runtime.host}</span></div>
        <div><span className="text-text-dim block">Port</span><span className="font-mono">{runtime.port}</span></div>
        <div><span className="text-text-dim block">心跳</span>{heartbeat}</div>
        <div><span className="text-text-dim block">Capabilities</span>{caps.join(', ') || 'general'}</div>
      </div>
      <div className="mt-3 pt-3 border-t border-border text-xs">
        <span className="text-text-dim">运行中 Agent:</span>
        <div className="mt-1 text-text-dim text-[11px]">暂无 agent 关联</div>
      </div>
    </div>
  );
}
