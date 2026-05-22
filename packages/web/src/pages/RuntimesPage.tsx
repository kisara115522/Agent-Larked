import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { get } from '../api/client';
import { EmptyState, ErrorState, Metric, MetricStrip, PageHeader, PageShell, Panel } from '../components/ui/PageState';

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
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await get<{ runtimes: Runtime[] }>('/runtimes', token).catch(() => ({ runtimes: [] }));
      setRuntimes(res.runtimes);
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Runtime 数据加载失败');
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const onlineCount = runtimes.filter(runtime => runtime.status === 'online').length;
  const usedSlots = runtimes.reduce((sum, runtime) => sum + runtime.agent_count, 0);
  const totalSlots = runtimes.reduce((sum, runtime) => sum + runtime.max_agents, 0);
  const saturatedCount = runtimes.filter(runtime => runtime.max_agents > 0 && runtime.agent_count >= runtime.max_agents).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Runtime"
        eyebrow="Operations"
        subtitle={`${onlineCount}/${runtimes.length} 在线 · ${usedSlots}/${totalSlots || 0} 槽位占用`}
        action={
          <button
            onClick={() => setShowHelp(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-semibold bg-accent text-white hover:bg-accent-hover transition-colors duration-150"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
            注册新 Runtime
          </button>
        }
      />

      <PageShell>
        {loadError && <div className="mb-4"><ErrorState message={loadError} onRetry={load} /></div>}
        <MetricStrip className="mb-5">
          <Metric label="Runtime" value={runtimes.length} detail={`${onlineCount} online`} tone="accent" />
          <Metric label="槽位占用" value={`${usedSlots}/${totalSlots || 0}`} detail={`${saturatedCount} 台满载`} tone={usedSlots > 0 ? 'success' : 'muted'} />
          <Metric label="离线" value={runtimes.length - onlineCount} detail="心跳断开的 daemon" tone={runtimes.length - onlineCount > 0 ? 'warning' : 'muted'} />
          <Metric label="能力集合" value={new Set(runtimes.flatMap(runtime => runtime.capabilities || [])).size} detail="capability tags" tone="muted" />
        </MetricStrip>

        <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-5 max-[1100px]:grid-cols-1">
          <Panel title="Runtime 队列" meta={`${runtimes.length}`}>
            {runtimes.length === 0 ? (
              <EmptyState
                className="py-16"
                title="还没有 Runtime"
                description="启动 Runtime daemon 后，它会自动注册并出现在这里。"
                action={
                  <button
                    onClick={() => setShowHelp(true)}
                    className="px-4 py-2 rounded-full bg-accent text-white text-[12px] font-semibold hover:bg-accent-hover transition-colors"
                  >
                    查看启动方式
                  </button>
                }
              />
            ) : (
              <>
                <div className="grid grid-cols-[minmax(220px,1fr)_100px_140px_120px_minmax(180px,1fr)] gap-3 px-4 py-2.5 border-b border-border bg-surface-elevated/60 text-[10px] text-text-dim uppercase tracking-[0.12em] font-semibold max-[900px]:hidden">
                  <span>Endpoint</span>
                  <span>状态</span>
                  <span>槽位</span>
                  <span>心跳</span>
                  <span>Capabilities</span>
                </div>
                <div className="divide-y divide-border/70">
                  {runtimes.map((rt, i) => (
                    <RuntimeRow key={rt.id} runtime={rt} index={i} />
                  ))}
                </div>
              </>
            )}
          </Panel>

          <aside className="space-y-4">
            <Panel title="调用链" meta="architecture">
              <div className="p-4 space-y-3 text-[12px]">
                <RuntimeStep title="Flock Server" desc="REST、SSE、SQLite、MCP" />
                <RuntimeStep title="HTTP Callback" desc="HMAC-SHA256 保护的控制通道" />
                <RuntimeStep title="Runtime Daemon" desc="注册、心跳、spawn / wake / stop" />
                <RuntimeStep title="Agent 子进程" desc="按 Runtime 槽位拉起" last />
              </div>
            </Panel>
          </aside>
        </div>
      </PageShell>

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

function RuntimeRow({ runtime, index }: { runtime: Runtime; index: number }) {
  const isOnline = runtime.status === 'online';
  const caps = Array.isArray(runtime.capabilities) ? runtime.capabilities : [];

  const heartbeat = runtime.last_heartbeat_at
    ? `${Math.round((Date.now() - new Date(runtime.last_heartbeat_at).getTime()) / 1000)}s ago`
    : '从未';

  return (
    <div
      className="grid grid-cols-[minmax(220px,1fr)_100px_140px_120px_minmax(180px,1fr)] gap-3 px-4 py-3 hover:bg-surface-elevated/45 transition-colors max-[900px]:grid-cols-1"
      style={{ animation: `fadeUp .35s ease-out ${index * 50}ms both` }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-success status-dot-online' : 'bg-text-dim'}`} />
        <span className="font-mono font-semibold text-[13px] truncate">{runtime.host}:{runtime.port}</span>
      </div>
      <div>
        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${isOnline ? 'bg-success-muted text-success' : 'bg-surface-elevated text-text-muted'}`}>
          {isOnline ? '在线' : runtime.status}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
          <span>{runtime.agent_count}/{runtime.max_agents}</span>
          <span className="text-text-dim">{runtime.max_agents > 0 ? `${Math.round(runtime.agent_count / runtime.max_agents * 100)}%` : '0%'}</span>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-surface-elevated overflow-hidden">
          <div className="h-full rounded-full bg-accent" style={{ width: `${runtime.max_agents > 0 ? Math.min(runtime.agent_count / runtime.max_agents * 100, 100) : 0}%` }} />
        </div>
      </div>
      <div className="text-[11px] text-text-muted font-mono">{heartbeat}</div>
      <div className="text-[11px] text-text-muted truncate">{caps.join(', ') || 'general'}</div>
    </div>
  );
}

function RuntimeStep({ title, desc, last = false }: { title: string; desc: string; last?: boolean }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="w-2 h-2 rounded-full bg-accent mt-1.5" />
        {!last && <span className="w-px flex-1 bg-border mt-2" />}
      </div>
      <div className="pb-3">
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="text-[11px] text-text-muted mt-0.5">{desc}</div>
      </div>
    </div>
  );
}
