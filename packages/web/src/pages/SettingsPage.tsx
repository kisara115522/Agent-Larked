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
    return <div className="h-full flex items-center justify-center"><p className="text-sm text-text-muted">加载中...</p></div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-border shrink-0 bg-surface min-h-[56px]">
        <h3 className="text-base font-semibold">全局设置</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-5 max-w-[800px]">
        {/* Token Budget */}
        {budget && (
          <>
            <h4 className="text-[15px] font-semibold mb-3 pb-2 border-b border-border">Token 预算</h4>
            <div className="grid grid-cols-2 gap-3 mb-2">
              <BudgetCard
                label="每日限额"
                limit={budget.daily_limit}
                current={budget.current_daily}
              />
              <BudgetCard
                label="每月限额"
                limit={budget.monthly_limit}
                current={budget.current_monthly}
              />
            </div>
            {budget.last_reset_at && (
              <div className="text-[11px] text-text-dim mb-4">
                上次重置: {new Date(budget.last_reset_at).toLocaleString('zh-CN')}
              </div>
            )}
          </>
        )}

        {/* Agent Configs */}
        {agentConfigs.length > 0 && (
          <>
            <h4 className="text-[15px] font-semibold mb-3 pb-2 border-b border-border mt-6">Agent 配置</h4>
            {agentConfigs.map(c => (
              <div key={c.config_type} className="flex items-center gap-3 py-2.5 border-b border-border">
                <span className="text-[13px] font-medium flex-1">{c.config_type}</span>
                {typeof c.config_value === 'boolean' ? (
                  <button
                    onClick={() => handleToggleConfig(c.config_type, c.config_value)}
                    className={`w-9 h-5 rounded-full relative cursor-pointer shrink-0 transition-colors ${c.config_value ? 'bg-accent' : 'bg-border'}`}
                  >
                    <div className={`absolute w-4 h-4 rounded-full bg-white top-0.5 transition-transform ${c.config_value ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                  </button>
                ) : (
                  <span className="text-xs text-text-muted font-mono">{JSON.stringify(c.config_value)}</span>
                )}
              </div>
            ))}
          </>
        )}

        {/* Global Configs */}
        {globalConfigs.length > 0 && (
          <>
            <h4 className="text-[15px] font-semibold mb-3 pb-2 border-b border-border mt-6">服务器配置</h4>
            {globalConfigs.map(c => (
              <div key={c.config_type} className="flex items-center gap-3 py-2.5 border-b border-border">
                <span className="text-[13px] font-medium flex-1">{c.config_type}</span>
                <span className="text-xs text-text-muted font-mono">{JSON.stringify(c.config_value)}</span>
              </div>
            ))}
          </>
        )}

        {/* Empty state */}
        {agentConfigs.length === 0 && globalConfigs.length === 0 && !budget && (
          <div className="text-center text-text-dim text-sm py-8">
            暂无配置数据
          </div>
        )}
      </div>
    </div>
  );
}

function BudgetCard({ label, limit, current }: { label: string; limit: number; current: number }) {
  const pct = limit > 0 ? Math.min((current / limit) * 100, 100) : 0;
  return (
    <div className="bg-bg border border-border rounded p-2.5 px-3">
      <div className="text-[10px] text-text-dim uppercase tracking-wider">{label}</div>
      <div className="text-[13px] font-medium font-mono mt-0.5">
        {current.toLocaleString()} / {limit.toLocaleString()} tokens
      </div>
      <div className="mt-1.5 h-1 bg-border rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
