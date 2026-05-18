import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { post } from '../../api/client';
import { useToast } from '../ui/Toast';

interface Agent {
  id: string;
  name: string;
  display_name: string;
  bio?: string;
}

interface Runtime {
  id: string;
  host: string;
  port: number;
  agent_count: number;
  max_agents: number;
}

export function SpawnModal({ agents, runtimes, onClose, onSpawned }: {
  agents: Agent[];
  runtimes: Runtime[];
  onClose: () => void;
  onSpawned: () => void;
}) {
  const { token, human } = useAuth();
  const [selectedAgent, setSelectedAgent] = useState(agents[0]?.id || '');
  const [selectedRuntime, setSelectedRuntime] = useState('auto');
  const [prompt, setPrompt] = useState('');
  const [spawning, setSpawning] = useState(false);
  const { toast } = useToast();

  const handleSpawn = async () => {
    if (!token || !selectedAgent) return;
    setSpawning(true);
    try {
      await post(`/agents/${selectedAgent}/spawn`, token, {
        runtime_id: selectedRuntime === 'auto' ? undefined : selectedRuntime,
        prompt: prompt.trim() || undefined,
      });
      toast('Agent 启动成功', 'success');
      onSpawned();
      onClose();
    } catch (e) {
      toast(`启动失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setSpawning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="w-[520px] p-6 bg-surface border border-border rounded-[14px] max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-5">启动 Agent</h3>

        <div className="mb-4">
          <label className="block text-xs text-text-muted mb-1">Agent Profile</label>
          <select value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)} className="w-full px-3 py-2.5 bg-surface border border-border rounded-[14px] text-sm text-text focus:border-accent">
            {agents.map(a => (
              <option key={a.id} value={a.id}>{a.display_name || a.name} ({a.bio || '无描述'})</option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-text-muted mb-1">Runtime</label>
          <select value={selectedRuntime} onChange={e => setSelectedRuntime(e.target.value)} className="w-full px-3 py-2.5 bg-surface border border-border rounded-[14px] text-sm text-text focus:border-accent">
            <option value="auto">自动选择（基于 capabilities）</option>
            {runtimes.map(r => (
              <option key={r.id} value={r.id}>{r.host}:{r.port} — {r.agent_count}/{r.max_agents} agents</option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-text-muted mb-1">初始 Prompt</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="给 agent 的启动指令..."
            rows={3}
            className="w-full px-3 py-2.5 bg-surface border border-border rounded-[14px] text-sm text-text placeholder:text-text-dim focus:border-accent resize-none"
          />
        </div>


        {/* Spawn flow preview */}
        <div className="bg-bg border border-border rounded-[10px] p-4 mb-5">
          <h5 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">启动流程预览</h5>
          <div className="flex items-center gap-2 text-xs text-text-muted flex-wrap">
            <span>👤 {human?.display_name || human?.username || 'Human'}</span>
            <span className="text-text-dim">→</span>
            <span>Flock Server</span>
            <span className="text-text-dim">→</span>
            <span>选择 Runtime</span>
            <span className="text-text-dim">→</span>
            <span>POST callback</span>
            <span className="text-text-dim">→</span>
            <span>claude -p</span>
            <span className="text-text-dim">→</span>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent" />
            <span>active</span>
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-muted hover:text-text">取消</button>
          <button onClick={handleSpawn} disabled={spawning || !selectedAgent} className="px-4 py-2 text-sm font-semibold bg-accent text-white rounded-full hover:bg-accent-hover disabled:opacity-50">
            {spawning ? '启动中...' : '🚀 启动 Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}
