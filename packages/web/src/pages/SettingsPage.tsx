import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { get, patch } from '../api/client';

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
    } catch {} finally {
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
    } catch {}
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
          <p className="text-sm text-text-dim font-medium">加载中</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-12 pt-12 pb-6" style={{ animation: 'fadeUp .4s ease-out' }}>
        <h1 className="text-[36px] font-black tracking-tight leading-none" style={{ fontFamily: 'var(--font-display)' }}>
          设置
        </h1>
        <p className="text-[14px] text-text-dim mt-3 font-medium">全局配置与预算管理</p>
      </div>

      <div className="px-12 pb-12 max-w-[700px]">
        {/* Token Budget */}
        {budget && (
          <div className="mb-8">
            <h4 className="text-[13px] font-semibold text-text-dim uppercase tracking-[0.12em] mb-4">Token 预算</h4>
            <div className="grid grid-cols-2 gap-4">
              <BudgetCard label="每日限额" limit={budget.daily_limit} current={budget.current_daily} />
              <BudgetCard label="每月限额" limit={budget.monthly_limit} current={budget.current_monthly} />
            </div>
            {budget.last_reset_at && (
              <p className="text-[11px] text-text-dim mt-3">
                上次重置: {new Date(budget.last_reset_at).toLocaleString('zh-CN')}
              </p>
            )}
          </div>
        )}

        {/* Agent Configs */}
        {agentConfigs.length > 0 && (
          <div className="mb-8">
            <h4 className="text-[13px] font-semibold text-text-dim uppercase tracking-[0.12em] mb-4">Agent 配置</h4>
            <div className="bg-surface border border-border rounded-[10px] divide-y divide-border">
              {agentConfigs.map(c => (
                <div key={c.config_type} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="text-[13px] font-medium flex-1">{c.config_type}</span>
                  {typeof c.config_value === 'boolean' ? (
                    <button
                      onClick={() => handleToggleConfig(c.config_type, c.config_value)}
                      className={`w-10 h-5 rounded-full relative cursor-pointer shrink-0 transition-colors duration-200 ${c.config_value ? 'bg-accent' : 'bg-border'}`}
                    >
                      <div className={`absolute w-4 h-4 rounded-full bg-white top-0.5 transition-transform duration-200 ${c.config_value ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                    </button>
                  ) : (
                    <span className="text-[11px] text-text-muted font-mono">{JSON.stringify(c.config_value)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Global Configs */}
        {globalConfigs.length > 0 && (
          <div className="mb-8">
            <h4 className="text-[13px] font-semibold text-text-dim uppercase tracking-[0.12em] mb-4">服务器配置</h4>
            <div className="bg-surface border border-border rounded-[10px] divide-y divide-border">
              {globalConfigs.map(c => (
                <div key={c.config_type} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="text-[13px] font-medium flex-1">{c.config_type}</span>
                  <span className="text-[11px] text-text-muted font-mono">{JSON.stringify(c.config_value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {agentConfigs.length === 0 && globalConfigs.length === 0 && !budget && (
          <div className="text-center text-text-dim text-[13px] py-16">暂无配置数据</div>
        )}
      </div>
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
