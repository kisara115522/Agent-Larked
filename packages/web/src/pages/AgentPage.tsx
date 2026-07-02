import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { get, patch, post } from '../api/client';
import { useToast } from '../components/ui/Toast';
import { StatusIndicator } from '../components/agent/StatusIndicator';
import { EmptyState, Metric, MetricStrip, PageHeader, PageLoader, PageShell, Panel } from '../components/ui/PageState';

interface Agent {
  id: string;
  name: string;
  display_name: string;
  bio: string;
  capabilities: string[];
  status: string;
  model?: string;
  runtime_id?: string;
  session_id?: string;
  last_active_at?: string;
  created_at: string;
}

interface Task {
  id: string;
  title: string;
  status: string;
  assigned_to?: string;
  priority: number;
  created_at: string;
}

interface WorkflowEvent {
  id: string;
  type: 'tool' | 'msg' | 'think' | 'system' | 'error';
  agent: string;
  action: string;
  detail: string;
  time: string;
}

interface AgentConfig {
  config_type: string;
  config_value: unknown;
  is_global: boolean;
}

export function AgentPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const { subscribe } = useSSE();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [modelValue, setModelValue] = useState('');
  const [providerValue, setProviderValue] = useState('');
  const [providerEnvValue, setProviderEnvValue] = useState('');
  const [mcpValue, setMcpValue] = useState('');
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false);
  const [savingMcp, setSavingMcp] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadAgent = useCallback(async () => {
    if (!token || !id) return;
    try {
      const [agentData, statusData, tasksRes, activityRes, configRes] = await Promise.all([
        get<Agent>(`/agents/${id}`, token),
        get<{ status: string; runtime_id: string | null; session_id: string | null; last_active_at: string | null }>(`/agents/${id}/status`, token).catch(() => null),
        get<{ tasks: Task[] }>('/tasks', token).catch(() => ({ tasks: [] })),
        get<{ logs: Array<{ id: string; activity_type: string; detail?: string; created_at: string }> }>(`/agents/${id}/activity`, token).catch(() => ({ logs: [] })),
        get<{ agent_configs: AgentConfig[] }>(`/configs?agent_id=${id}`, token).catch(() => ({ agent_configs: [] })),
      ]);
      setAgent({
        ...agentData,
        runtime_id: statusData?.runtime_id ?? undefined,
        session_id: statusData?.session_id ?? undefined,
      });
      setTasks(tasksRes.tasks.filter(t => t.assigned_to === id));
      setConfigs(configRes.agent_configs);
      const modelConfig = configRes.agent_configs.find(c => c.config_type === 'model')?.config_value;
      const providerConfig = configRes.agent_configs.find(c => c.config_type === 'provider')?.config_value;
      setModelValue(typeof modelConfig === 'string' ? modelConfig : agentData.model || '');
      if (typeof providerConfig === 'string') {
        setProviderValue(providerConfig);
        setProviderEnvValue('');
      } else if (providerConfig && typeof providerConfig === 'object') {
        const cfg = providerConfig as { name?: unknown; env?: unknown };
        setProviderValue(typeof cfg.name === 'string' ? cfg.name : 'custom');
        setProviderEnvValue(cfg.env ? JSON.stringify(cfg.env, null, 2) : '');
      } else {
        setProviderValue('');
        setProviderEnvValue('');
      }
      const mcpConfig = configRes.agent_configs.find(c => c.config_type === 'mcp')?.config_value;
      setMcpValue(mcpConfig ? JSON.stringify(mcpConfig, null, 2) : '');
      // Convert activity logs to workflow events
      const converted: WorkflowEvent[] = activityRes.logs.slice(0, 20).map(ev => ({
        id: ev.id,
        type: ev.activity_type === 'tool_call' ? 'tool' : ev.activity_type === 'message' ? 'msg' : ev.activity_type === 'think' ? 'think' : ev.activity_type === 'error' ? 'error' : 'system',
        agent: agentData.display_name || agentData.name,
        action: ev.activity_type,
        detail: ev.detail || '',
        time: new Date(ev.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      }));
      if (converted.length > 0) setEvents(converted);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => { loadAgent(); }, [loadAgent]);

  // Real-time status updates
  useEffect(() => {
    return subscribe(event => {
      if (event.event === 'agent_status') {
        const data = event.data as { agent_id: string; status: string };
        if (data.agent_id === id) {
          setAgent(prev => prev ? { ...prev, status: data.status } : prev);
          // Re-fetch runtime/session info whenever status changes
          if (token && id) {
            get<{ status: string; runtime_id: string | null; session_id: string | null }>(`/agents/${id}/status`, token)
              .then(s => setAgent(prev => prev ? { ...prev, runtime_id: s.runtime_id ?? undefined, session_id: s.session_id ?? undefined } : prev))
              .catch(() => {});
          }
        }
      }
      if ((event.event === 'room_message' || event.event === 'direct_message') && id) {
        const data = event.data as { from?: string; from_agent?: string; from_name?: string; content?: string };
        const from = data.from_agent || data.from;
        if (from === id || data.from_name === agent?.name) {
          setEvents(prev => [{
            id: `${Date.now()}-${Math.random()}`,
            type: 'msg' as const,
            agent: data.from_name || from || 'unknown',
            action: '发送消息',
            detail: data.content?.slice(0, 120) || '',
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          }, ...prev].slice(0, 20));
        }
      }
    });
  }, [subscribe, id, agent?.name]);

  const { toast } = useToast();

  const handleStop = async () => {
    if (!token || !id) return;
    try { await post(`/agents/${id}/stop`, token); toast('Agent 已停止', 'success'); loadAgent(); } catch (e) { toast(`停止失败: ${e instanceof Error ? e.message : '未知错误'}`); }
  };

  const handleWake = async () => {
    if (!token || !id) return;
    try { await post(`/agents/${id}/wake`, token, {}); toast('唤醒成功', 'success'); loadAgent(); } catch (e) { toast(`唤醒失败: ${e instanceof Error ? e.message : '未知错误'}`); }
  };

  const handleSpawn = async () => {
    if (!token || !id) return;
    try { await post(`/agents/${id}/spawn`, token, {}); toast('启动成功', 'success'); loadAgent(); } catch (e) { toast(`启动失败: ${e instanceof Error ? e.message : '未知错误'}`); }
  };

  const handleSaveRuntimeConfig = async () => {
    if (!token || !id) return;
    setSavingConfig(true);
    try {
      const model = modelValue.trim();
      await patch('/configs', token, {
        agent_id: id,
        config_type: 'model',
        config_value: model || '',
      });

      const providerName = providerValue.trim();
      let providerConfig: unknown = providerName;
      const envText = providerEnvValue.trim();
      if (envText) {
        providerConfig = {
          name: providerName || 'custom',
          env: JSON.parse(envText),
        };
      }
      await patch('/configs', token, {
        agent_id: id,
        config_type: 'provider',
        config_value: providerConfig || '',
      });
      toast('运行配置已保存', 'success');
      loadAgent();
    } catch (e) {
      toast(`保存失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSaveMcp = async () => {
    if (!token || !id) return;
    setSavingMcp(true);
    try {
      const parsed = mcpValue.trim() ? JSON.parse(mcpValue) : { mcpServers: {} };
      if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
        throw new Error('JSON must be {"mcpServers": {...}}');
      }
      await patch('/configs', token, { agent_id: id, config_type: 'mcp', config_value: parsed });
      toast('MCP 配置已保存', 'success');
      setMcpEditorOpen(false);
      loadAgent();
    } catch (e) {
      toast(`保存失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setSavingMcp(false);
    }
  };

  if (loading) {
    return <PageLoader label="加载 Agent" />;
  }

  if (!agent) {
    return <div className="h-full flex items-center justify-center"><p className="text-sm text-text-muted">未找到 Agent</p></div>;
  }

  const currentTasks = tasks.filter(t => t.status === 'in_progress' || t.status === 'review');
  const historyTasks = tasks.filter(t => t.status === 'done' || t.status === 'rejected' || t.status === 'error');
  const statusBadgeClass = agent.status === 'active' ? 'bg-[#064E3B] text-[#34D399]'
    : agent.status === 'recovering' ? 'bg-[#78350F] text-[#FBBF24]'
    : agent.status === 'error' ? 'bg-error-muted text-error'
    : agent.status === 'spawning' ? 'bg-accent-muted text-accent'
    : 'bg-surface-elevated text-text-muted border border-border';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        eyebrow="Agent"
        title={agent.display_name || agent.name}
        subtitle={agent.bio || '无描述'}
        action={
          <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusBadgeClass}`}>
            <StatusIndicator status={agent.status as 'active' | 'dormant' | 'recovering' | 'error' | 'spawning'} />
            {agent.status}
          </span>
          {agent.status === 'active' && (
            <button onClick={handleStop} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-error-muted text-error hover:bg-error hover:text-white transition-colors">停止 Agent</button>
          )}
          {(agent.status === 'dormant' || agent.status === 'error') && (
            <>
              <button onClick={handleWake} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-success-muted text-success hover:bg-success hover:text-white transition-colors">唤醒</button>
              <button onClick={handleSpawn} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-accent text-white hover:bg-accent-hover transition-colors">启动</button>
            </>
          )}
          </div>
        }
      />

      <PageShell>
        <MetricStrip className="mb-5">
          <Metric label="状态" value={agent.status} detail={agent.last_active_at ? formatRelativeTime(agent.last_active_at) : '从未活跃'} tone={agent.status === 'active' ? 'success' : agent.status === 'error' ? 'error' : 'muted'} />
          <Metric label="当前任务" value={currentTasks.length} detail={`${historyTasks.length} 历史任务`} tone={currentTasks.length > 0 ? 'warning' : 'muted'} />
          <Metric label="Runtime" value={agent.runtime_id ? agent.runtime_id.slice(0, 8) : '—'} detail={agent.session_id || '无 Session'} tone={agent.runtime_id ? 'accent' : 'muted'} />
          <Metric label="配置" value={configs.length} detail="agent scoped config" tone="muted" />
        </MetricStrip>

        <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-5 max-[1100px]:grid-cols-1">
          <div className="space-y-5">
            <Panel title="当前任务" meta={`${currentTasks.length}`}>
              <TaskList tasks={currentTasks} emptyTitle="没有进行中的任务" emptyDesc="任务进入进行中或审查中后，会出现在这里。" />
            </Panel>

            <Panel title="最近活动" meta={`${events.length}`}>
              {events.length > 0 ? (
                <div className="divide-y divide-border/70 text-xs text-text-muted">
                  {events.map(ev => (
                    <div key={ev.id} className="grid grid-cols-[58px_100px_minmax(0,1fr)] gap-3 px-4 py-2.5 hover:bg-surface-elevated/45">
                      <span className="font-mono text-text-dim">{ev.time}</span>
                      <span className="text-text-muted">{ev.action}</span>
                      <span className="truncate">{ev.detail || ev.action}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState className="py-10" title="没有最近活动" description="Agent 发送消息、调用工具或状态变化后，会在这里显示。" />
              )}
            </Panel>

            <Panel title="历史任务" meta={`${historyTasks.length}`}>
              <TaskList tasks={historyTasks} emptyTitle="没有历史任务" emptyDesc="完成、退回或错误状态的任务会记录在这里。" muted />
            </Panel>
          </div>

          <aside className="space-y-5">
            <Panel title="能力标签" meta={`${agent.capabilities.length}`}>
              <div className="p-4 flex gap-1.5 flex-wrap">
              {agent.capabilities.length > 0 ? agent.capabilities.map(cap => (
                <span key={cap} className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-surface-elevated text-text-muted border border-border">{cap}</span>
              )) : (
                <span className="text-xs text-text-dim">无能力标签</span>
              )}
              </div>
            </Panel>

            <Panel title="运行配置">
              <div className="p-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] text-text-dim uppercase tracking-wider">Model</span>
                  <input
                    value={modelValue}
                    onChange={e => setModelValue(e.target.value)}
                    placeholder="opus / sonnet / claude-sonnet-4-6"
                    className="input mt-1"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-text-dim uppercase tracking-wider">Provider</span>
                  <input
                    value={providerValue}
                    onChange={e => setProviderValue(e.target.value)}
                    placeholder="default / bedrock / xiavier"
                    className="input mt-1"
                  />
                </label>
              </div>
              <label className="block mt-3">
                <span className="text-[11px] text-text-dim uppercase tracking-wider">Provider Env JSON</span>
                <textarea
                  value={providerEnvValue}
                  onChange={e => setProviderEnvValue(e.target.value)}
                  placeholder='{"ANTHROPIC_BASE_URL":"https://...","ANTHROPIC_AUTH_TOKEN":"..."}'
                  className="input mt-1 min-h-[92px] font-mono text-[11px] resize-y"
                />
              </label>
              <div className="flex items-center justify-between mt-3">
                <span className="text-[11px] text-text-dim">{configs.length} 条配置</span>
                <button
                  onClick={handleSaveRuntimeConfig}
                  disabled={savingConfig}
                  className="px-4 py-2 rounded-full text-[12px] font-semibold bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors"
                >
                  {savingConfig ? '保存中...' : '保存运行配置'}
                </button>
              </div>
              </div>
            </Panel>

            <Panel title="配置文件">
              <div className="p-3 grid grid-cols-2 gap-2.5">
              <ConfigCard marker="S" title="Soul" desc="人格描述、行为准则" badge="—" badgeClass="bg-surface-elevated text-text-muted border border-border" />
              <ConfigCard marker="A" title="Agent.md" desc="能力定义、工作方式" badge="—" badgeClass="bg-surface-elevated text-text-muted border border-border" />
              <ConfigCard marker="K" title="Skills" desc="继承全局配置" badge="—" badgeClass="bg-surface-elevated text-text-muted border border-border" />
              <button type="button" onClick={() => setMcpEditorOpen(true)} className="text-left">
                <ConfigCard
                  marker="M"
                  title="MCP Tools"
                  desc="工具接入配置"
                  badge={mcpValue.trim() ? '已配置' : '未配置'}
                  badgeClass={mcpValue.trim() ? 'bg-accent-muted text-accent' : 'bg-surface-elevated text-text-muted border border-border'}
                />
              </button>
            </div>
            </Panel>

            {mcpEditorOpen && (
              <Panel title="MCP JSON 编辑">
                <div className="p-4 space-y-3">
                  <p className="text-[11px] text-text-muted">格式：<code className="font-mono">{`{"mcpServers":{"echo":{"type":"stdio","command":"echo","args":["hi"]}}}`}</code>。需 server 启用 <code>FLOCK_PER_AGENT_MCP=1</code> 才会生效。</p>
                  <textarea
                    value={mcpValue}
                    onChange={e => setMcpValue(e.target.value)}
                    placeholder='{"mcpServers":{"echo":{"type":"stdio","command":"echo","args":["hi"]}}}'
                    className="input min-h-[220px] font-mono text-[11px] resize-y w-full"
                  />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setMcpEditorOpen(false)} className="px-3 py-1.5 rounded-full text-xs bg-surface-elevated">取消</button>
                    <button onClick={handleSaveMcp} disabled={savingMcp} className="px-3 py-1.5 rounded-full text-xs bg-accent text-white disabled:opacity-40">
                      {savingMcp ? '保存中...' : '保存'}
                    </button>
                  </div>
                </div>
              </Panel>
            )}
          </aside>
        </div>
      </PageShell>
    </div>
  );
}

function TaskList({ tasks, emptyTitle, emptyDesc, muted = false }: {
  tasks: Task[];
  emptyTitle: string;
  emptyDesc: string;
  muted?: boolean;
}) {
  return (
    <div className="divide-y divide-border/70">
      {tasks.length > 0 ? tasks.map(task => (
        <div key={task.id} className={`px-4 py-3 flex items-center gap-3 hover:bg-surface-elevated/45 ${muted ? 'opacity-75' : ''}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${task.status === 'error' || task.status === 'rejected' ? 'bg-error' : task.status === 'done' ? 'bg-success' : 'bg-warning'}`} />
          <span className="text-[13px] font-medium flex-1 truncate">{task.title}</span>
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${task.status === 'in_progress' ? 'bg-warning-muted text-warning' : task.status === 'review' ? 'bg-accent-muted text-accent' : task.status === 'done' ? 'bg-success-muted text-success' : 'bg-error-muted text-error'}`}>
            {task.status}
          </span>
        </div>
      )) : (
        <EmptyState className="py-10" title={emptyTitle} description={emptyDesc} />
      )}
    </div>
  );
}

function ConfigCard({ marker, title, desc, badge, badgeClass }: { marker: string; title: string; desc: string; badge: string; badgeClass: string }) {
  return (
    <div className="bg-surface border border-border rounded-[10px] p-3 cursor-pointer hover:border-text-dim transition-colors">
      <div className="w-7 h-7 rounded-[8px] bg-surface-elevated border border-border flex items-center justify-center text-[11px] font-bold text-text-dim mb-2">
        {marker}
      </div>
      <div className="text-[13px] font-semibold">{title}</div>
      <div className="text-xs text-text-muted">{desc}</div>
      <div className="mt-1.5">
        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${badgeClass}`}>{badge}</span>
      </div>
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
