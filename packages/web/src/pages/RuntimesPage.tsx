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
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-border flex items-center gap-3 shrink-0 bg-surface min-h-[56px]">
        <h3 className="text-base font-semibold">Runtime 管理</h3>
        <div className="ml-auto">
          <button onClick={() => setShowHelp(true)} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[13px] font-semibold bg-accent text-white hover:bg-accent-hover transition-colors">
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

      {/* Help Modal */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowHelp(false)}>
          <div className="w-[520px] p-6 bg-surface border border-border rounded-[14px]" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">注册新 Runtime</h3>
            <p className="text-sm text-text-muted mb-4">
              Runtime daemon 启动后会自动注册到 Flock Server。无需手动注册。
            </p>
            <div className="bg-bg border border-border rounded p-4 font-mono text-xs leading-relaxed mb-4">
              <div className="text-text-dim mb-2"># 在目标机器上启动 Runtime daemon</div>
              <div>AGENT_TOKEN=&lt;agent-token&gt; \</div>
              <div>CALLBACK_PORT=4000 \</div>
              <div>FLOCK_SERVER_URL=http://your-server:3001 \</div>
              <div>npx tsx packages/runtime/src/index.ts</div>
            </div>
            <div className="text-xs text-text-muted space-y-1.5">
              <p>• Runtime 启动后自动向 Server 注册，无需手动操作</p>
              <p>• 心跳间隔默认 30 秒，Server 通过心跳判断 Runtime 是否在线</p>
              <p>• spawn/wake 请求会自动路由到可用的 Runtime</p>
            </div>
            <div className="mt-5 flex justify-end">
              <button onClick={() => setShowHelp(false)} className="px-4 py-2 rounded-full text-sm font-semibold bg-accent text-white hover:bg-accent-hover transition-colors">
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
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
