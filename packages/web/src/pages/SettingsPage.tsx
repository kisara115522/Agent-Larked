import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { get, patch } from '../api/client';
import { EmptyState, ErrorState, PageHeader, PageLoader, PageShell, Panel } from '../components/ui/PageState';

interface AgentConfig {
  config_type: string;
  config_value: unknown;
  is_global: boolean;
}

interface GlobalConfig {
  config_type: string;
  config_value: unknown;
}

interface TokenBudget {
  agent_id: string;
  daily_limit: number;
  monthly_limit: number;
  current_daily: number;
  current_monthly: number;
  last_reset_at: string | null;
}

export function SettingsPage() {
  const { token } = useAuth();
  const [agentConfigs, setAgentConfigs] = useState<AgentConfig[]>([]);
  const [globalConfigs, setGlobalConfigs] = useState<GlobalConfig[]>([]);
  const [budget, setBudget] = useState<TokenBudget | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [configRes, budgetRes] = await Promise.all([
        get<{ agent_configs: AgentConfig[]; global_configs: GlobalConfig[] }>('/configs', token).catch(() => ({ agent_configs: [], global_configs: [] })),
        get<TokenBudget>('/token-budgets', token).catch(() => null),
      ]);
      setAgentConfigs(configRes.agent_configs);
      setGlobalConfigs(configRes.global_configs);
      setBudget(budgetRes);
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '设置加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleToggleConfig = async (configType: string, currentValue: unknown) => {
    if (!token) return;
    const newValue = !(currentValue as boolean);
    try {
      await patch('/configs', token, { config_type: configType, config_value: newValue });
      setAgentConfigs(prev =>
        prev.map(c => c.config_type === configType ? { ...c, config_value: newValue } : c),
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '配置更新失败');
    }
  };

  if (loading) {
    return <PageLoader label="加载设置" />;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="设置" eyebrow="Admin" subtitle="全局配置与预算管理" />

      <PageShell>
        {loadError && <div className="mb-4"><ErrorState message={loadError} onRetry={load} /></div>}
        <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-5 max-[1100px]:grid-cols-1">
          <div className="space-y-5">
            {agentConfigs.length > 0 && (
              <ConfigList title="Agent 配置" items={agentConfigs} onToggle={handleToggleConfig} />
            )}

            {globalConfigs.length > 0 && (
              <Panel title="服务器配置" meta={`${globalConfigs.length}`}>
                <div className="divide-y divide-border">
                  {globalConfigs.map(c => (
                    <div key={c.config_type} className="grid grid-cols-[minmax(180px,260px)_minmax(0,1fr)] gap-4 px-5 py-3.5 max-[760px]:grid-cols-1">
                      <span className="text-[13px] font-semibold">{c.config_type}</span>
                      <span className="text-[11px] text-text-muted font-mono break-all">{JSON.stringify(c.config_value)}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            {agentConfigs.length === 0 && globalConfigs.length === 0 && (
              <Panel title="配置项" meta="0">
                <EmptyState
                  className="py-16"
                  title="还没有配置项"
                  description={budget ? '预算记录已加载，Server 或 Agent 配置返回后会出现在这里。' : 'Server 返回配置后，这里会显示全局设置、Agent 配置和预算状态。'}
                />
              </Panel>
            )}
          </div>

          <aside className="space-y-5">
            {budget && (
              <Panel title="Token 预算" meta="budget">
                <div className="p-4 space-y-4">
                  <BudgetCard label="每日限额" limit={budget.daily_limit} current={budget.current_daily} />
                  <BudgetCard label="每月限额" limit={budget.monthly_limit} current={budget.current_monthly} />
                  {budget.last_reset_at && (
                    <p className="text-[11px] text-text-dim">
                      上次重置: {new Date(budget.last_reset_at).toLocaleString('zh-CN')}
                    </p>
                  )}
                </div>
              </Panel>
            )}

            <Panel title="配置状态">
              <div className="p-4 space-y-3 text-[12px]">
                <StatusLine label="Agent 配置" value={agentConfigs.length} />
                <StatusLine label="Server 配置" value={globalConfigs.length} />
                <StatusLine label="预算记录" value={budget ? 1 : 0} />
              </div>
            </Panel>
          </aside>
        </div>
      </PageShell>
    </div>
  );
}

function ConfigList({ title, items, onToggle }: {
  title: string;
  items: AgentConfig[];
  onToggle: (configType: string, currentValue: unknown) => void;
}) {
  return (
    <Panel title={title} meta={`${items.length}`}>
      <div className="divide-y divide-border">
        {items.map(c => (
          <div key={c.config_type} className="grid grid-cols-[minmax(180px,260px)_minmax(0,1fr)_64px] gap-4 px-5 py-3.5 items-center max-[760px]:grid-cols-1">
            <span className="text-[13px] font-semibold">{c.config_type}</span>
            <span className="text-[11px] text-text-muted font-mono break-all">
              {typeof c.config_value === 'boolean' ? String(c.config_value) : JSON.stringify(c.config_value)}
            </span>
            {typeof c.config_value === 'boolean' ? (
              <button
                onClick={() => onToggle(c.config_type, c.config_value)}
                className={`w-10 h-5 rounded-full relative cursor-pointer shrink-0 transition-colors duration-200 ${c.config_value ? 'bg-accent' : 'bg-border'}`}
              >
                <div className={`absolute w-4 h-4 rounded-full bg-white top-0.5 transition-transform duration-200 ${c.config_value ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
              </button>
            ) : (
              <span className="text-[10px] text-text-dim">只读</span>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function StatusLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono text-text">{value}</span>
    </div>
  );
}

function BudgetCard({ label, limit, current }: { label: string; limit: number; current: number }) {
  const pct = limit > 0 ? Math.min((current / limit) * 100, 100) : 0;
  return (
    <div className="bg-surface border border-border rounded-[10px] p-5">
      <div className="text-[11px] text-text-dim uppercase tracking-[0.12em] font-semibold">{label}</div>
      <div className="text-[14px] font-semibold font-mono mt-2">
        {current.toLocaleString()} / {limit.toLocaleString()}
      </div>
      <div className="mt-3 h-1.5 bg-border/50 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${pct > 90 ? 'bg-error' : pct > 70 ? 'bg-warning' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
