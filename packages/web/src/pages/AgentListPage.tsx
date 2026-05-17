import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../context/SSEContext';
import { get, post } from '../api/client';
import { AgentAvatar } from '../components/agent/AgentAvatar';
import { StatusIndicator } from '../components/agent/StatusIndicator';

interface Agent {
  id: string;
  name: string;
  display_name: string;
  bio: string;
  capabilities: string[];
  status: string;
  runtime_id?: string;
  last_active_at?: string;
}

export function AgentListPage() {
  const { token } = useAuth();
  const { subscribe } = useSSE();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBio, setNewBio] = useState('');
  const [newCapabilities, setNewCapabilities] = useState('');
  const [creating, setCreating] = useState(false);

  const loadAgents = useCallback(async () => {
    if (!token) return;
    try {
      const res = await get<{ agents: Agent[] }>('/agents', token);
      setAgents(res.agents);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  // Real-time status updates
  useEffect(() => {
    return subscribe(event => {
      if (event.event === 'agent_status') {
        const data = event.data as { agent_id: string; status: string };
        setAgents(prev => prev.map(a => a.id === data.agent_id ? { ...a, status: data.status } : a));
      }
    });
  }, [subscribe]);

  const handleSpawn = async (agentId: string) => {
    if (!token) return;
    try {
      await post(`/agents/${agentId}/spawn`, token, {});
      loadAgents();
    } catch (err) {
      console.error('Failed to spawn agent:', err);
    }
  };

  const handleStop = async (agentId: string) => {
    if (!token) return;
    try {
      await post(`/agents/${agentId}/stop`, token);
      loadAgents();
    } catch (err) {
      console.error('Failed to stop agent:', err);
    }
  };

  const handleWake = async (agentId: string) => {
    if (!token) return;
    try {
      await post(`/agents/${agentId}/wake`, token, {});
      loadAgents();
    } catch (err) {
      console.error('Failed to wake agent:', err);
    }
  };

  const handleCreate = async () => {
    if (!token || !newName.trim()) return;
    setCreating(true);
    try {
      await post('/agents', token, {
        name: newName.trim(),
        bio: newBio.trim() || undefined,
        capabilities: newCapabilities.trim() ? newCapabilities.split(',').map(s => s.trim()) : [],
      });
      setShowCreate(false);
      setNewName('');
      setNewBio('');
      setNewCapabilities('');
      loadAgents();
    } catch (err) {
      console.error('Failed to create agent:', err);
    } finally {
      setCreating(false);
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active': return 'Running';
      case 'dormant': return 'Sleeping';
      case 'recovering': return 'Recovering';
      case 'error': return 'Error';
      default: return status;
    }
  };

  const getActionButtons = (agent: Agent) => {
    switch (agent.status) {
      case 'active':
        return (
          <button
            onClick={(e) => { e.stopPropagation(); handleStop(agent.id); }}
            className="px-3 py-1.5 text-xs font-medium bg-error/10 text-error rounded-lg hover:bg-error/20 transition-colors"
          >
            Stop
          </button>
        );
      case 'dormant':
        return (
          <div className="flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); handleWake(agent.id); }}
              className="px-3 py-1.5 text-xs font-medium bg-warning/10 text-warning rounded-lg hover:bg-warning/20 transition-colors"
            >
              Wake
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleStop(agent.id); }}
              className="px-3 py-1.5 text-xs font-medium bg-error/10 text-error rounded-lg hover:bg-error/20 transition-colors"
            >
              Stop
            </button>
          </div>
        );
      case 'recovering':
        return (
          <span className="text-xs text-warning">Recovering...</span>
        );
      case 'error':
        return (
          <button
            onClick={(e) => { e.stopPropagation(); handleSpawn(agent.id); }}
            className="px-3 py-1.5 text-xs font-medium bg-accent/10 text-accent rounded-lg hover:bg-accent/20 transition-colors"
          >
            Restart
          </button>
        );
      default:
        return (
          <button
            onClick={(e) => { e.stopPropagation(); handleSpawn(agent.id); }}
            className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            Start
          </button>
        );
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-text-muted">Loading agents...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-border shrink-0 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Agents</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 text-sm font-medium bg-accent text-white rounded-lg hover:opacity-90 transition-opacity"
        >
          + Create Agent
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-3xl mb-3">🤖</p>
            <p className="text-sm text-text-muted">No agents yet</p>
            <p className="text-xs text-text-muted mt-1">Create your first agent to get started</p>
          </div>
        ) : (
          <div className="space-y-2">
            {agents.map(agent => (
              <div
                key={agent.id}
                onClick={() => navigate(`/agents/${agent.id}`)}
                className="flex items-center gap-4 p-4 bg-surface rounded-lg border border-border hover:border-accent/50 cursor-pointer transition-colors"
              >
                <AgentAvatar name={agent.name} displayName={agent.display_name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium truncate">{agent.display_name || agent.name}</h3>
                    <StatusIndicator status={agent.status as 'active' | 'dormant' | 'recovering' | 'error'} />
                    <span className="text-xs text-text-muted">{getStatusLabel(agent.status)}</span>
                  </div>
                  {agent.bio && <p className="text-xs text-text-muted mt-0.5 truncate">{agent.bio}</p>}
                  <div className="flex items-center gap-2 mt-1">
                    {agent.capabilities.slice(0, 3).map(cap => (
                      <span key={cap} className="px-1.5 py-0.5 text-[10px] bg-surface-elevated rounded font-mono">
                        {cap}
                      </span>
                    ))}
                    {agent.capabilities.length > 3 && (
                      <span className="text-[10px] text-text-muted">+{agent.capabilities.length - 3}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {getActionButtons(agent)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Agent Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="w-96 p-6 bg-surface rounded-lg border border-border" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Create Agent</h3>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Agent name"
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent mb-3"
            />
            <input
              type="text"
              value={newBio}
              onChange={(e) => setNewBio(e.target.value)}
              placeholder="Bio (optional)"
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent mb-3"
            />
            <input
              type="text"
              value={newCapabilities}
              onChange={(e) => setNewCapabilities(e.target.value)}
              placeholder="Capabilities (comma-separated)"
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm text-text-muted hover:text-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="px-4 py-2 text-sm font-medium bg-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
