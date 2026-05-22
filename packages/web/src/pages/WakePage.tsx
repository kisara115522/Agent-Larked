import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { get, post } from '../api/client';
import { useToast } from '../components/ui/Toast';
import { AgentAvatar } from '../components/agent/AgentAvatar';
import { WakeSingleModal } from '../components/modals/WakeSingleModal';
import { EmptyState, ErrorState, Metric, MetricStrip, PageHeader, PageLoader, PageShell, Panel } from '../components/ui/PageState';

interface Agent {
  id: string;
  name: string;
  display_name: string;
  status: string;
  last_active_at: string | null;
}

interface Room {
  id: string;
  name: string;
}

interface WakeEvent {
  id: string;
  agent_id: string;
  agent_name?: string;
  triggered_by: string;
  triggered_by_name?: string;
  trigger_type: string;
  room_id?: string;
  prompt?: string;
  status: string;
  created_at: string;
}

export function WakePage() {
  const { token } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [wakeHistory, setWakeHistory] = useState<WakeEvent[]>([]);
  const [selectedRoom, setSelectedRoom] = useState('');
  const [wakeAgent, setWakeAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const { toast } = useToast();

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [agentsRes, roomsRes, historyRes] = await Promise.all([
        get<{ agents: Agent[] }>('/agents', token),
        get<{ rooms: Room[] }>('/rooms', token).catch(() => ({ rooms: [] })),
        get<{ events: WakeEvent[] }>('/activity/wake-history', token).catch(() => ({ events: [] })),
      ]);
      setAgents(agentsRes.agents);
      setRooms(roomsRes.rooms);
      setWakeHistory(historyRes.events);
      if (roomsRes.rooms.length > 0 && !selectedRoom) setSelectedRoom(roomsRes.rooms[0].id);
      setLoadError('');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '唤醒数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [token, selectedRoom, toast]);

  useEffect(() => { load(); }, [load]);

  const dormantAgents = agents.filter(a => a.status === 'dormant' || a.status === 'error');
  const errorAgents = agents.filter(a => a.status === 'error');

  const handleBroadcastWake = async () => {
    if (!token || !selectedRoom) return;
    try {
      await post(`/rooms/${selectedRoom}/broadcast-wake`, token, {});
      toast('Broadcast 唤醒已发送', 'success');
      load();
    } catch (e) {
      toast(`唤醒失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  };

  const handleQuickWake = async (agentId: string) => {
    if (!token) return;
    try {
      await post(`/agents/${agentId}/wake`, token, {});
      toast('唤醒成功', 'success');
      load();
    } catch (e) {
      toast(`唤醒失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  };

  if (loading) return <PageLoader label="加载唤醒状态" />;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="唤醒"
        eyebrow="Operations"
        subtitle={`${dormantAgents.length} 个 Agent 可唤醒 · ${wakeHistory.length} 条历史记录`}
      />

      <PageShell>
        {loadError && <div className="mb-4"><ErrorState message={loadError} onRetry={load} /></div>}
        <MetricStrip className="mb-5">
          <Metric label="可唤醒" value={dormantAgents.length} detail={`${errorAgents.length} error`} tone={dormantAgents.length > 0 ? 'warning' : 'muted'} />
          <Metric label="Room" value={rooms.length} detail="可广播目标" tone="accent" />
          <Metric label="历史" value={wakeHistory.length} detail="wake events" tone="muted" />
        </MetricStrip>

        <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-5 max-[1100px]:grid-cols-1">
          <Panel title="手动唤醒" meta={`${dormantAgents.length}`}>
        {dormantAgents.length === 0 ? (
          <EmptyState
            className="py-16"
            title="没有需要唤醒的 Agent"
            description="当前没有 dormant 或 error 状态的 Agent。Agent 休眠后会出现在这里。"
          />
        ) : (
          <div className="divide-y divide-border/70">
          {dormantAgents.map(agent => (
            <div key={agent.id} className="px-4 py-3 flex items-center gap-3">
              <AgentAvatar name={agent.name} displayName={agent.display_name} size="lg" />
              <div className="flex-1">
                <div className="text-sm font-semibold">{agent.display_name || agent.name}</div>
                <div className="text-xs text-text-muted mt-0.5">
                  {agent.status} · {agent.last_active_at ? `${formatRelativeTime(agent.last_active_at)}未活跃` : '从未活跃'} · 最后 Session: 无
                </div>
              </div>
              <button onClick={() => setWakeAgent(agent)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-success-muted text-success hover:bg-success hover:text-white transition-colors">
                唤醒
              </button>
              <button onClick={() => handleQuickWake(agent.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-accent text-white hover:bg-accent-hover transition-colors">
                启动到 Runtime
              </button>
            </div>
          ))}
          </div>
        )}
          </Panel>

          <aside className="space-y-5">
            <Panel title="Broadcast 唤醒">
        <div className="p-4 space-y-4">
          <div>
            <div className="text-sm font-semibold">唤醒 Room 内所有 dormant agent</div>
            <div className="text-xs text-text-muted mt-0.5">向 Room 内所有处于 dormant 状态的 agent 发送唤醒 callback</div>
          </div>
          <select value={selectedRoom} onChange={e => setSelectedRoom(e.target.value)} className="w-full px-3 py-2 bg-surface border border-border rounded-[10px] text-sm text-text">
            {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            {rooms.length === 0 && <option>选择 Room...</option>}
          </select>
          <button onClick={handleBroadcastWake} className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold bg-success-muted text-success hover:bg-success hover:text-white transition-colors">
            全部唤醒
          </button>
        </div>
            </Panel>

            <Panel title="唤醒历史" meta={`${wakeHistory.length}`}>
        {wakeHistory.length === 0 ? (
          <EmptyState
            className="py-10"
            title="还没有唤醒记录"
            description="手动唤醒、@mention 或 broadcast wake 触发后，记录会按时间出现在这里。"
          />
        ) : (
          <div className="text-xs text-text-muted p-2 max-h-[460px] overflow-y-auto">
            {wakeHistory.slice(0, 20).map(ev => (
              <div key={ev.id} className="py-2 px-2 rounded-[8px] hover:bg-surface-elevated/50 flex gap-2 items-center">
                <span className="font-mono text-text-dim w-[60px] shrink-0">
                  {new Date(ev.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="font-semibold">{ev.agent_name || ev.agent_id.slice(0, 8)}</span>
                <span className="text-text-dim truncate">被 {ev.triggered_by_name || ev.triggered_by.slice(0, 8)} 唤醒</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-surface-elevated text-text-muted border border-border">
                  {ev.trigger_type === 'manual' ? '手动' : ev.trigger_type === 'mention' ? '@mention' : ev.trigger_type === 'broadcast' ? '广播' : ev.trigger_type === 'spawn' ? '启动' : ev.trigger_type}
                </span>
                <span className={`ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${ev.status === 'queued' || ev.status === 'sent' ? 'bg-[#064E3B] text-[#34D399]' : ev.status === 'skipped' ? 'bg-[#78350F] text-[#FBBF24]' : ev.status === 'failed' ? 'bg-error-muted text-error' : 'bg-surface-elevated text-text-muted border border-border'}`}>
                  {ev.status === 'queued' ? '已排队' : ev.status === 'sent' ? '已发送' : ev.status === 'skipped' ? '跳过' : ev.status === 'failed' ? '失败' : ev.status}
                </span>
              </div>
            ))}
          </div>
        )}
            </Panel>
          </aside>
        </div>
      </PageShell>

      {/* Wake Single Modal */}
      {wakeAgent && (
        <WakeSingleModal
          agentId={wakeAgent.id}
          agentName={wakeAgent.name}
          agentStatus={wakeAgent.status}
          lastActive={wakeAgent.last_active_at ? formatRelativeTime(wakeAgent.last_active_at) : undefined}
          rooms={rooms}
          onClose={() => setWakeAgent(null)}
          onWoken={load}
        />
      )}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
