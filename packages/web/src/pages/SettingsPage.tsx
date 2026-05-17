import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { get } from '../api/client';

interface GlobalConfig {
  config_type: string;
  config_value: string;
}

export function SettingsPage() {
  const { token } = useAuth();
  const [configs, setConfigs] = useState<GlobalConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await get<{ configs: GlobalConfig[] }>('/configs', token).catch(() => ({ configs: [] }));
      setConfigs(res.configs);
    } catch {} finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="h-full flex items-center justify-center"><p className="text-sm text-text-muted">Loading...</p></div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-border shrink-0 bg-surface min-h-[56px]">
        <h3 className="text-base font-semibold">全局设置</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-5 max-w-[800px]">
        {/* Global Skills */}
        <h4 className="text-[15px] font-semibold mb-3 pb-2 border-b border-border">全局 Skills</h4>
        <ToggleRow name="web-search" desc="网络搜索" defaultOn />
        <ToggleRow name="file-operations" desc="文件读写" defaultOn />
        <ToggleRow name="code-analysis" desc="代码分析审查" defaultOn />
        <ToggleRow name="database-query" desc="数据库查询" defaultOn />
        <ToggleRow name="agentmemory" desc="Agent 外部记忆" defaultOn />

        {/* Global MCP Servers */}
        <h4 className="text-[15px] font-semibold mb-3 pb-2 border-b border-border mt-6">全局 MCP Servers</h4>
        <MCPToggleRow name="flock-server" transport="stdio" desc="post, read, wait, react, thread, mentions, dm, room, task, agent" defaultOn />
        <MCPToggleRow name="github-mcp" transport="stdio" desc="GitHub PR/Issue/Repo" defaultOn />
        <MCPToggleRow name="agentmemory" transport="stdio" desc="save, recall, reflect, consolidate, smart_search" defaultOn />

        {/* Token Budget Defaults */}
        <h4 className="text-[15px] font-semibold mb-3 pb-2 border-b border-border mt-6">Token 预算默认值</h4>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div className="bg-bg border border-border rounded p-2.5 px-3">
            <div className="text-[10px] text-text-dim uppercase tracking-wider">每日限额</div>
            <div className="text-[13px] font-medium font-mono mt-0.5">100,000 tokens</div>
          </div>
          <div className="bg-bg border border-border rounded p-2.5 px-3">
            <div className="text-[10px] text-text-dim uppercase tracking-wider">每月限额</div>
            <div className="text-[13px] font-medium font-mono mt-0.5">3,000,000 tokens</div>
          </div>
        </div>

        {/* Global Configs from API */}
        {configs.length > 0 && (
          <>
            <h4 className="text-[15px] font-semibold mb-3 pb-2 border-b border-border mt-6">服务器配置</h4>
            {configs.map(c => (
              <div key={c.config_type} className="flex items-center gap-3 py-2.5 border-b border-border">
                <span className="text-[13px] font-medium flex-1">{c.config_type}</span>
                <span className="text-xs text-text-muted font-mono">{c.config_value}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function ToggleRow({ name, desc, defaultOn }: { name: string; desc: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn ?? false);
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border">
      <span className="text-[13px] font-medium flex-1">{name}</span>
      <span className="text-xs text-text-muted">{desc}</span>
      <button
        onClick={() => setOn(!on)}
        className={`w-9 h-5 rounded-full relative cursor-pointer shrink-0 transition-colors ${on ? 'bg-accent' : 'bg-border'}`}
      >
        <div className={`absolute w-4 h-4 rounded-full bg-white top-0.5 transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

function MCPToggleRow({ name, transport, desc, defaultOn }: { name: string; transport: string; desc: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn ?? false);
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border">
      <div className="flex-1">
        <span className="text-[13px] font-medium">{name}</span>
        <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${transport === 'stdio' ? 'bg-[#064E3B] text-[#34D399]' : 'bg-accent-muted text-accent'}`}>
          {transport}
        </span>
        <div className="text-xs text-text-muted mt-0.5">{desc}</div>
      </div>
      <button
        onClick={() => setOn(!on)}
        className={`w-9 h-5 rounded-full relative cursor-pointer shrink-0 transition-colors ${on ? 'bg-accent' : 'bg-border'}`}
      >
        <div className={`absolute w-4 h-4 rounded-full bg-white top-0.5 transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}
