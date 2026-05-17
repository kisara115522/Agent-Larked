import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { get } from '../api/client';

interface Agent {
  id: string;
  name: string;
  display_name: string;
  status: string;
}

interface TokenBudget {
  agent_id: string;
  daily_limit: number;
  monthly_limit: number;
  current_daily: number;
  current_monthly: number;
}

interface AgentConfig {
  agent_id: string;
  config_type: string;
  config_value: string;
}

interface GlobalConfig {
  config_type: string;
  config_value: string;
}

export function SettingsPage() {
  const { token } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [budgets, setBudgets] = useState<TokenBudget[]>([]);
  const [globalConfigs, setGlobalConfigs] = useState<GlobalConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'tokens' | 'configs'>('tokens');

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [agentsRes, budgetsRes, configsRes] = await Promise.allSettled([
        get<{ agents: Agent[] }>('/agents', token),
        get<{ budgets: TokenBudget[] }>('/token-budgets', token),
        get<{ configs: GlobalConfig[] }>('/configs', token),
      ]);
      if (agentsRes.status === 'fulfilled') setAgents(agentsRes.value.agents);
      if (budgetsRes.status === 'fulfilled') setBudgets(budgetsRes.value.budgets);
      if (configsRes.status === 'fulfilled') setGlobalConfigs(configsRes.value.configs);
    } catch {
      // API may not be ready
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-text-muted">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-border shrink-0">
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-text-muted">Token budgets and configuration</p>
      </header>

      <div className="px-6 pt-3 border-b border-border shrink-0 flex gap-4">
        {(['tokens', 'configs'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-accent text-accent'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {tab === 'tokens' ? 'Token Usage' : 'Configuration'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'tokens' && (
          <TokenUsageTab agents={agents} budgets={budgets} />
        )}
        {activeTab === 'configs' && (
          <ConfigTab configs={globalConfigs} />
        )}
      </div>
    </div>
  );
}

function TokenUsageTab({ agents, budgets }: { agents: Agent[]; budgets: TokenBudget[] }) {
  const budgetByAgent = new Map(budgets.map(b => [b.agent_id, b]));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Total Agents"
          value={agents.length.toString()}
          sub={`${agents.filter(a => a.status === 'active').length} active`}
        />
        <StatCard
          label="Daily Token Limit"
          value={budgets.length > 0 ? formatNumber(budgets[0].daily_limit) : '—'}
          sub="per agent"
        />
        <StatCard
          label="Monthly Token Limit"
          value={budgets.length > 0 ? formatNumber(budgets[0].monthly_limit) : '—'}
          sub="per agent"
        />
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-elevated text-text-muted text-xs">
              <th className="text-left px-4 py-2 font-medium">Agent</th>
              <th className="text-right px-4 py-2 font-medium">Daily Used</th>
              <th className="text-right px-4 py-2 font-medium">Daily Limit</th>
              <th className="text-right px-4 py-2 font-medium">Monthly Used</th>
              <th className="text-right px-4 py-2 font-medium">Monthly Limit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {agents.map(agent => {
              const budget = budgetByAgent.get(agent.id);
              return (
                <tr key={agent.id} className="hover:bg-surface-elevated/50">
                  <td className="px-4 py-2">
                    <span className="font-medium">{agent.display_name || agent.name}</span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-text-muted">
                    {budget ? formatNumber(budget.current_daily) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-text-muted">
                    {budget ? formatNumber(budget.daily_limit) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-text-muted">
                    {budget ? formatNumber(budget.current_monthly) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-text-muted">
                    {budget ? formatNumber(budget.monthly_limit) : '—'}
                  </td>
                </tr>
              );
            })}
            {agents.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-muted">
                  No agents registered
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ConfigTab({ configs }: { configs: GlobalConfig[] }) {
  return (
    <div className="space-y-4">
      {configs.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-3xl mb-3">⚙</p>
          <p className="text-sm text-text-muted">No configuration set</p>
          <p className="text-xs text-text-muted mt-1">Configuration will appear here when the config API is available</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-elevated text-text-muted text-xs">
                <th className="text-left px-4 py-2 font-medium">Key</th>
                <th className="text-left px-4 py-2 font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {configs.map(c => (
                <tr key={c.config_type} className="hover:bg-surface-elevated/50">
                  <td className="px-4 py-2 font-mono text-xs">{c.config_type}</td>
                  <td className="px-4 py-2 text-text-muted">{c.config_value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="p-4 bg-surface border border-border rounded-lg">
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <p className="text-xl font-semibold text-text">{value}</p>
      {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
