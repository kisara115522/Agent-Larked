import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
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
  model?: string;
  created_at: string;
}

export function AgentPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const { subscribe } = useSSE();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAgent = useCallback(async () => {
    if (!token || !id) return;
    try {
      const data = await get<Agent>(`/agents/${id}`, token);
      setAgent(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  // Real-time status updates
  useEffect(() => {
    return subscribe(event => {
      if (event.event === 'agent_status') {
        const data = event.data as { agent_id: string; status: string };
        if (data.agent_id === id) {
          setAgent(prev => prev ? { ...prev, status: data.status } : prev);
        }
      }
    });
  }, [subscribe, id]);

  const handleSpawn = async () => {
    if (!token || !id) return;
    try {
      await post(`/agents/${id}/spawn`, token, {});
      loadAgent();
    } catch (err) {
      console.error('Failed to spawn agent:', err);
    }
  };

  const handleStop = async () => {
    if (!token || !id) return;
    try {
      await post(`/agents/${id}/stop`, token);
      loadAgent();
    } catch (err) {
      console.error('Failed to stop agent:', err);
    }
  };

  const handleWake = async () => {
    if (!token || !id) return;
    try {
      await post(`/agents/${id}/wake`, token, {});
      loadAgent();
    } catch (err) {
      console.error('Failed to wake agent:', err);
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

  const getActionButtons = () => {
    if (!agent) return null;
    switch (agent.status) {
      case 'active':
        return (
          <button
            onClick={handleStop}
            className="px-4 py-2 text-sm font-medium bg-error/10 text-error rounded-lg hover:bg-error/20 transition-colors"
          >
            Stop
          </button>
        );
      case 'dormant':
        return (
          <div className="flex gap-2">
            <button
              onClick={handleWake}
              className="px-4 py-2 text-sm font-medium bg-warning/10 text-warning rounded-lg hover:bg-warning/20 transition-colors"
            >
              Wake
            </button>
            <button
              onClick={handleStop}
              className="px-4 py-2 text-sm font-medium bg-error/10 text-error rounded-lg hover:bg-error/20 transition-colors"
            >
              Stop
            </button>
          </div>
        );
      case 'recovering':
        return (
          <span className="text-sm text-warning">Recovering...</span>
        );
      case 'error':
        return (
          <button
            onClick={handleSpawn}
            className="px-4 py-2 text-sm font-medium bg-accent/10 text-accent rounded-lg hover:bg-accent/20 transition-colors"
          >
            Restart
          </button>
        );
      default:
        return (
          <button
            onClick={handleSpawn}
            className="px-4 py-2 text-sm font-medium bg-accent text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            Start
          </button>
        );
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-text-muted">Loading agent...</p>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-text-muted">Agent not found</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-border shrink-0">
        <h2 className="text-lg font-semibold">Agent Profile</h2>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-lg mx-auto">
          <div className="flex items-start gap-4">
            <AgentAvatar name={agent.name} displayName={agent.display_name} size="lg" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-semibold">{agent.display_name || agent.name}</h3>
                <StatusIndicator status={agent.status as 'active' | 'dormant' | 'recovering' | 'error'} size="md" />
                <span className="text-sm text-text-muted">{getStatusLabel(agent.status)}</span>
              </div>
              <p className="text-sm text-text-muted font-mono mt-0.5">{agent.name}</p>
              {agent.bio && <p className="text-sm text-text mt-2">{agent.bio}</p>}
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            {getActionButtons()}
          </div>

          {agent.capabilities.length > 0 && (
            <div className="mt-6">
              <p className="text-xs text-text-muted uppercase tracking-wider mb-2">Capabilities</p>
              <div className="flex flex-wrap gap-2">
                {agent.capabilities.map(cap => (
                  <span
                    key={cap}
                    className="px-2.5 py-1 rounded-full text-xs border border-border bg-surface font-mono"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-4 text-xs text-text-muted">
            <div>
              <p className="uppercase tracking-wider mb-1">Model</p>
              <p className="text-text font-mono">{agent.model || 'unknown'}</p>
            </div>
            <div>
              <p className="uppercase tracking-wider mb-1">Joined</p>
              <p className="text-text font-mono">{new Date(agent.created_at).toLocaleDateString()}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
