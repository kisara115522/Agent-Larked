import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { get } from '../api/client';
import { AgentAvatar } from '../components/agent/AgentAvatar';
import { EmptyState, ErrorState, Metric, MetricStrip, PageHeader, PageLoader, PageShell, Panel } from '../components/ui/PageState';

interface Agent {
  id: string;
  name: string;
  display_name: string;
}

interface TokenBudget {
  agent_id: string;
  daily_limit: number;
  monthly_limit: number;
  current_daily: number;
  current_monthly: number;
}

interface TokenUsage {
  agent_id: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  created_at: string;
}

export function TokensPage() {
  const { token } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [budgets, setBudgets] = useState<TokenBudget[]>([]);
  const [usage, setUsage] = useState<TokenUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [agentsRes, budgetRes, usageRes] = await Promise.all([
        get<{ agents: Agent[] }>('/agents', token),
        get<TokenBudget>('/token-budgets', token).catch(() => null),
        get<{ usage: TokenUsage[] }>('/token-usage', token).catch(() => ({ usage: [] })),
      ]);
      setAgents(agentsRes.agents);
      setBudgets(budgetRes ? [budgetRes] : []);
      setUsage(usageRes.usage);
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Token 数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Aggregate usage by agent
  const usageByAgent = new Map<string, { input: number; output: number; total: number; cost: number }>();
  for (const u of usage) {
    const existing = usageByAgent.get(u.agent_id) || { input: 0, output: 0, total: 0, cost: 0 };
    existing.input += u.input_tokens;
    existing.output += u.output_tokens;
    existing.total += u.input_tokens + u.output_tokens;
    existing.cost += u.cost_usd || 0;
    usageByAgent.set(u.agent_id, existing);
  }

  const totalDaily = usage.reduce((sum, u) => sum + u.input_tokens + u.output_tokens, 0);
  const totalCost = usage.reduce((sum, u) => sum + (u.cost_usd || 0), 0);
  const defaultDailyLimit = budgets[0]?.daily_limit || 100000;

  if (loading) return <PageLoader label="加载 Token 数据" />;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Token 消耗"
        eyebrow="Operations"
        subtitle={`今日: ${new Date().toISOString().slice(0, 10)}`}
      />

      <PageShell>
        {loadError && <div className="mb-4"><ErrorState message={loadError} onRetry={load} /></div>}
        <MetricStrip className="mb-5">
          <Metric label="今日总消耗" value={totalDaily.toLocaleString()} detail={`预算 ${defaultDailyLimit.toLocaleString()} / 日`} tone={totalDaily > 0 ? 'accent' : 'muted'} />
          <Metric label="本月总消耗" value="—" detail="预算 3M / 月" tone="muted" />
          <Metric label="估算费用" value={`$${totalCost.toFixed(2)}`} detail="input + output" tone={totalCost > 0 ? 'warning' : 'muted'} />
          <Metric label="Agent" value={agents.length} detail="纳入预算统计" tone="muted" />
        </MetricStrip>

        <Panel title="按 Agent 分解" meta={`${agents.length}`}>
          <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[720px]">
            <thead>
              <tr className="text-left">
                <th className="py-2.5 px-4 border-b border-border text-[10px] text-text-dim uppercase tracking-[0.12em]">Agent</th>
                <th className="py-2.5 px-4 border-b border-border text-[10px] text-text-dim uppercase tracking-[0.12em]">输入</th>
                <th className="py-2.5 px-4 border-b border-border text-[10px] text-text-dim uppercase tracking-[0.12em]">输出</th>
                <th className="py-2.5 px-4 border-b border-border text-[10px] text-text-dim uppercase tracking-[0.12em]">总计</th>
                <th className="py-2.5 px-4 border-b border-border text-[10px] text-text-dim uppercase tracking-[0.12em]">费用</th>
                <th className="py-2.5 px-4 border-b border-border text-[10px] text-text-dim uppercase tracking-[0.12em]">预算</th>
              </tr>
            </thead>
            <tbody>
              {agents.map(agent => {
                const u = usageByAgent.get(agent.id);
                const budget = budgets.find(b => b.agent_id === agent.id);
                const dailyLimit = budget?.daily_limit || defaultDailyLimit;
                return (
                  <tr key={agent.id} className="border-b border-border">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <AgentAvatar name={agent.name} displayName={agent.display_name} size="sm" />
                        {agent.display_name || agent.name}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono">{u ? u.input.toLocaleString() : '0'}</td>
                    <td className="py-3 px-4 font-mono">{u ? u.output.toLocaleString() : '0'}</td>
                    <td className="py-3 px-4 font-mono font-semibold">{u ? u.total.toLocaleString() : '0'}</td>
                    <td className="py-3 px-4 font-mono">{u ? `$${u.cost.toFixed(2)}` : '$0.00'}</td>
                    <td className="py-3 px-4 w-[160px]">
                      <TokenBar value={u?.total || 0} max={dailyLimit} color="bg-accent" />
                    </td>
                  </tr>
                );
              })}
              {agents.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10">
                    <EmptyState
                      title="还没有 Agent"
                      description="创建 Agent 后，这里会显示每个 Agent 的输入、输出、总量和预算消耗。"
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </Panel>
      </PageShell>
    </div>
  );
}

function TokenBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(value / max * 100, 100) : 0;
  return (
    <div className="h-1 bg-bg rounded-sm mt-1.5 overflow-hidden">
      <div className={`h-full rounded-sm ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
