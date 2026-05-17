import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { get } from '../api/client';
import { AgentAvatar } from '../components/agent/AgentAvatar';

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

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [agentsRes, budgetsRes, usageRes] = await Promise.all([
        get<{ agents: Agent[] }>('/agents', token),
        get<{ budgets: TokenBudget[] }>('/token-budgets', token).catch(() => ({ budgets: [] })),
        get<{ usage: TokenUsage[] }>('/token-usage', token).catch(() => ({ usage: [] })),
      ]);
      setAgents(agentsRes.agents);
      setBudgets(budgetsRes.budgets);
      setUsage(usageRes.usage);
    } catch {}
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

  const getAgentName = (id: string) => agents.find(a => a.id === id)?.display_name || agents.find(a => a.id === id)?.name || id;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-border flex items-center gap-3 shrink-0 bg-surface min-h-[56px]">
        <h3 className="text-base font-semibold">Token 消耗</h3>
        <div className="ml-auto text-xs text-text-muted">今日: {new Date().toISOString().slice(0, 10)}</div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-3 p-5">
          <div className="bg-surface border border-border rounded-[10px] p-4">
            <div className="text-[11px] text-text-muted uppercase tracking-wider">今日总消耗</div>
            <div className="text-[28px] font-bold tracking-tight mt-0.5">{totalDaily.toLocaleString()}</div>
            <TokenBar value={totalDaily} max={defaultDailyLimit} color="bg-accent" />
            <div className="text-xs text-text-muted mt-1">预算 {defaultDailyLimit.toLocaleString()} / 日 ({(totalDaily / defaultDailyLimit * 100).toFixed(1)}%)</div>
          </div>
          <div className="bg-surface border border-border rounded-[10px] p-4">
            <div className="text-[11px] text-text-muted uppercase tracking-wider">本月总消耗</div>
            <div className="text-[28px] font-bold tracking-tight mt-0.5">-</div>
            <TokenBar value={0} max={3000000} color="bg-[#34D399]" />
            <div className="text-xs text-text-muted mt-1">预算 3M / 月</div>
          </div>
          <div className="bg-surface border border-border rounded-[10px] p-4">
            <div className="text-[11px] text-text-muted uppercase tracking-wider">估算费用</div>
            <div className="text-[28px] font-bold tracking-tight mt-0.5">${totalCost.toFixed(2)}</div>
            <div className="text-xs text-text-muted mt-1">输入 + 输出</div>
          </div>
        </div>

        {/* Per-Agent Breakdown */}
        <div className="px-6 pb-6">
          <h4 className="text-sm font-semibold mb-3">按 Agent 分解</h4>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left">
                <th className="py-2 px-3 border-b border-border text-[11px] text-text-dim uppercase">Agent</th>
                <th className="py-2 px-3 border-b border-border text-[11px] text-text-dim">输入</th>
                <th className="py-2 px-3 border-b border-border text-[11px] text-text-dim">输出</th>
                <th className="py-2 px-3 border-b border-border text-[11px] text-text-dim">总计</th>
                <th className="py-2 px-3 border-b border-border text-[11px] text-text-dim">费用</th>
                <th className="py-2 px-3 border-b border-border text-[11px] text-text-dim">预算</th>
              </tr>
            </thead>
            <tbody>
              {agents.map(agent => {
                const u = usageByAgent.get(agent.id);
                const budget = budgets.find(b => b.agent_id === agent.id);
                const dailyLimit = budget?.daily_limit || defaultDailyLimit;
                return (
                  <tr key={agent.id} className="border-b border-border">
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <AgentAvatar name={agent.name} displayName={agent.display_name} size="sm" />
                        {agent.display_name || agent.name}
                      </div>
                    </td>
                    <td className="py-2 px-3 font-mono">{u ? u.input.toLocaleString() : '0'}</td>
                    <td className="py-2 px-3 font-mono">{u ? u.output.toLocaleString() : '0'}</td>
                    <td className="py-2 px-3 font-mono font-semibold">{u ? u.total.toLocaleString() : '0'}</td>
                    <td className="py-2 px-3 font-mono">{u ? `$${u.cost.toFixed(2)}` : '$0.00'}</td>
                    <td className="py-2 px-3 w-[120px]">
                      <TokenBar value={u?.total || 0} max={dailyLimit} color="bg-accent" />
                    </td>
                  </tr>
                );
              })}
              {agents.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-text-dim">暂无 agent</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
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
