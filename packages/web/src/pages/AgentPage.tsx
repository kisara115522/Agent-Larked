import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { get, patch, post } from '../api/client';
import { useToast } from '../components/ui/Toast';
import { StatusIndicator } from '../components/agent/StatusIndicator';

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
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [modelValue, setModelValue] = useState('');
  const [providerValue, setProviderValue] = useState('');
  const [providerEnvValue, setProviderEnvValue] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadAgent = useCallback(async () => {
    if (!token || !id) return;
    try {
      const [agentData, tasksRes, activityRes, configRes] = await Promise.all([
        get<Agent>(`/agents/${id}`, token),
        get<{ tasks: Task[] }>('/tasks', token).catch(() => ({ tasks: [] })),
        get<{ logs: Array<{ id: string; activity_type: string; detail?: string; created_at: string }> }>(`/agents/${id}/activity`, token).catch(() => ({ logs: [] })),
        get<{ agent_configs: AgentConfig[] }>(`/configs?agent_id=${id}`, token).catch(() => ({ agent_configs: [] })),
      ]);
      setAgent(agentData);
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
        }
      }
      if ((event.event === 'room_message' || event.event === 'direct_message') && id) {
        const data = event.data as { from_agent?: string; from_name?: string; content?: string };
        if (data.from_agent === id || data.from_name === agent?.name) {
          setEvents(prev => [{
            id: `${Date.now()}-${Math.random()}`,
            type: 'msg' as const,
            agent: data.from_name || data.from_agent || 'unknown',
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

  if (loading) {
    return <div className="h-full flex items-center justify-center"><p className="text-sm text-text-muted">加载中...</p></div>;
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-3 border-b border-border flex items-center gap-3 shrink-0 bg-surface min-h-[56px]">
        <button onClick={() => navigate('/agents')} className="w-8 h-8 rounded-full flex items-center justify-center bg-surface-elevated text-text-muted border border-border hover:border-text-dim transition-colors text-sm">
          ←
        </button>
        <h3 className="text-base font-semibold">{agent.display_name || agent.name}</h3>
        <div className="ml-auto flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusBadgeClass}`}>
            <StatusIndicator status={agent.status as 'active' | 'dormant' | 'recovering' | 'error' | 'spawning'} />
            {agent.status}
          </span>
          {agent.status === 'active' && (
            <button onClick={handleStop} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-error-muted text-error hover:bg-error hover:text-white transition-colors">停止 Agent</button>
          )}
          {(agent.status === 'dormant' || agent.status === 'error') && (
            <>
              <button onClick={handleWake} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#064E3B] text-[#34D399] hover:bg-[#34D399] hover:text-white transition-colors">唤醒</button>
              <button onClick={handleSpawn} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-accent text-white hover:bg-accent-hover transition-colors">启动</button>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-[800px]">
          {/* Detail Grid */}
          <div className="grid grid-cols-2 gap-2.5 mb-5">
            <DetailField label="Runtime" value={agent.runtime_id ? `已分配 (${agent.runtime_id.slice(0, 8)})` : '未分配'} />
            <DetailField label="Session ID" value={agent.session_id || '—'} mono />
            <DetailField label="最后活跃" value={agent.last_active_at ? formatRelativeTime(agent.last_active_at) : '从未'} />
            <DetailField label="Token 预算" value="—" />
          </div>

          {/* Capabilities */}
          <div className="mb-5">
            <h4 className="text-sm font-semibold mb-2">能力标签</h4>
            <div className="flex gap-1.5 flex-wrap">
              {agent.capabilities.length > 0 ? agent.capabilities.map(cap => (
                <span key={cap} className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-surface-elevated text-text-muted border border-border">{cap}</span>
              )) : (
                <span className="text-xs text-text-dim">无能力标签</span>
              )}
            </div>
          </div>

          {/* Current Tasks */}
          <div className="mb-5">
            <h4 className="text-sm font-semibold mb-2">当前任务</h4>
            {currentTasks.length > 0 ? currentTasks.map(task => (
              <div key={task.id} className="bg-surface border border-border rounded-[10px] p-3 mb-2">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#34D399]" />
                  <span className="text-[13px] font-medium flex-1">{task.title}</span>
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${task.status === 'in_progress' ? 'bg-[#78350F] text-[#FBBF24]' : 'bg-accent-muted text-accent'}`}>
                    {task.status === 'in_progress' ? '进行中' : '审查中'}
                  </span>
                </div>
              </div>
            )) : (
              <div className="text-xs text-text-dim py-3">暂无进行中的任务</div>
            )}
          </div>

          {/* History Tasks */}
          <div className="mb-5">
            <h4 className="text-sm font-semibold mb-2">历史任务</h4>
            {historyTasks.length > 0 ? historyTasks.map(task => (
              <div key={task.id} className="bg-surface border border-border rounded-[10px] p-3 mb-2 opacity-70">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${task.status === 'done' ? 'bg-[#064E3B] text-[#34D399]' : 'bg-error-muted text-error'}`}>
                    {task.status === 'done' ? '✓' : '✗'}
                  </span>
                  <span className="text-[13px] flex-1">{task.title}</span>
                </div>
              </div>
            )) : (
              <div className="text-xs text-text-dim py-3">暂无历史任务</div>
            )}
          </div>

          {/* Recent Activity */}
          <div className="mb-5">
            <h4 className="text-sm font-semibold mb-2">最近活动</h4>
            {events.length > 0 ? (
              <div className="text-xs text-text-muted">
                {events.map(ev => (
                  <div key={ev.id} className="py-1.5 border-b border-border flex gap-2.5">
                    <span className="font-mono text-text-dim w-[50px] shrink-0">{ev.time}</span>
                    <span>{ev.detail || ev.action}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-text-dim py-3">暂无最近活动</div>
            )}
          </div>

          {/* Config Cards */}
          <div className="mb-5">
            <h4 className="text-sm font-semibold mb-2">运行配置</h4>
            <div className="bg-surface border border-border rounded-[10px] p-4">
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
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-2">配置</h4>
            <div className="grid grid-cols-2 gap-2.5">
              <ConfigCard icon="🧠" title="Soul" desc="人格描述、行为准则" badge="—" badgeClass="bg-surface-elevated text-text-muted border border-border" />
              <ConfigCard icon="📄" title="Agent.md" desc="能力定义、工作方式" badge="—" badgeClass="bg-surface-elevated text-text-muted border border-border" />
              <ConfigCard icon="🔧" title="Skills" desc="继承全局配置" badge="—" badgeClass="bg-surface-elevated text-text-muted border border-border" />
              <ConfigCard icon="🔌" title="MCP Tools" desc="工具接入配置" badge="—" badgeClass="bg-surface-elevated text-text-muted border border-border" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-bg border border-border rounded-md p-2.5">
      <div className="text-[10px] text-text-dim uppercase tracking-wider">{label}</div>
      <div className={`text-[13px] font-medium mt-0.5 ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</div>
    </div>
  );
}

function ConfigCard({ icon, title, desc, badge, badgeClass }: { icon: string; title: string; desc: string; badge: string; badgeClass: string }) {
  return (
    <div className="bg-surface border border-border rounded-[10px] p-3 cursor-pointer hover:border-text-dim transition-colors">
      <div className="text-xl mb-1.5">{icon}</div>
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
