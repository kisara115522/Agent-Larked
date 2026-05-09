import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { get, post, patch, del } from '../api/client';

interface Agent {
  id: string;
  name: string;
  display_name: string;
  bio: string;
  status: string;
  capabilities: string[];
  created_at: string;
}

interface BatchResult {
  id: string;
  success: boolean;
  error?: string;
}

export function AdminPage() {
  const { token, agent: currentAgent } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [newAgentToken, setNewAgentToken] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDisplayName, setCreateDisplayName] = useState('');
  const [error, setError] = useState('');
  const [batchResults, setBatchResults] = useState<BatchResult[] | null>(null);

  const loadAgents = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = search ? `?q=${encodeURIComponent(search)}` : '';
      const res = await get<{ agents: Agent[] }>(`/agents${params}`, token);
      setAgents(res.agents);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [token, search]);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setError('');
    try {
      const res = await post<{ id: string; name: string; token: string }>('/agents', '', {
        name: createName.trim(),
        ...(createDisplayName.trim() ? { display_name: createDisplayName.trim() } : {}),
      });
      setNewAgentToken(res.token);
      setCreateName('');
      setCreateDisplayName('');
      setShowCreate(false);
      loadAgents();
    } catch (err) {
      setError((err as Error).message || 'Create failed');
    }
  };

  const handleEdit = (agent: Agent) => {
    setEditId(agent.id);
    setEditName(agent.name);
    setEditDisplayName(agent.display_name || '');
    setNewToken(null);
  };

  const handleSave = async (id: string) => {
    if (!token) return;
    setError('');
    try {
      await patch(`/agents/${id}`, token, {
        name: editName.trim(),
        display_name: editDisplayName.trim(),
      });
      setEditId(null);
      loadAgents();
    } catch (err) {
      setError((err as Error).message || 'Update failed');
    }
  };

  const handleDelete = async (id: string) => {
    if (!token) return;
    if (!confirm('Delete this agent? This cannot be undone.')) return;
    if (id === currentAgent?.id && !confirm('You are deleting your own account. You will be logged out.')) return;
    setError('');
    try {
      await del(`/agents/${id}`, token);
      if (id === currentAgent?.id) {
        window.location.reload();
        return;
      }
      loadAgents();
    } catch (err) {
      setError((err as Error).message || 'Delete failed');
    }
  };

  const handleRegenerateToken = async (id: string) => {
    if (!token) return;
    if (!confirm('Regenerate token? The old token will be invalidated immediately.')) return;
    setError('');
    try {
      const res = await post<{ id: string; token: string }>(`/agents/${id}/token`, token);
      setNewToken(res.token);
      loadAgents();
    } catch (err) {
      setError((err as Error).message || 'Token regeneration failed');
    }
  };

  const handleBatchDelete = async () => {
    if (!token || selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} agent(s)? This cannot be undone.`)) return;
    const selfDelete = selected.has(currentAgent?.id ?? '');
    if (selfDelete && !confirm('You are deleting your own account. You will be logged out.')) return;
    setError('');
    setBatchResults(null);
    try {
      const res = await post<{ results: BatchResult[] }>('/agents/batch-delete', token, {
        agent_ids: Array.from(selected),
      });
      setBatchResults(res.results);
      setSelected(new Set());
      if (selfDelete) {
        window.location.reload();
        return;
      }
      loadAgents();
    } catch (err) {
      setError((err as Error).message || 'Batch delete failed');
    }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === agents.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(agents.map(a => a.id)));
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold">Agent Management</h1>
            <p className="text-sm text-text-muted mt-1">Create, edit, and manage agent accounts</p>
          </div>
          <div className="flex gap-2">
            {selected.size > 0 && (
              <button
                onClick={handleBatchDelete}
                className="px-3 py-1.5 text-sm font-medium bg-error text-white rounded-lg hover:opacity-90 transition-opacity"
              >
                Delete {selected.size} selected
              </button>
            )}
            <button
              onClick={() => setShowCreate(true)}
              className="px-3 py-1.5 text-sm font-medium bg-accent text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              + New Agent
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-lg text-sm text-error">
            {error}
            <button onClick={() => setError('')} className="ml-2 underline">dismiss</button>
          </div>
        )}

        {newAgentToken && (
          <div className="mb-4 p-3 bg-accent/10 border border-accent/20 rounded-lg">
            <p className="text-sm text-text mb-1">Agent created. Save this token — it won't be shown again:</p>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono text-accent break-all flex-1">{newAgentToken}</code>
              <button
                onClick={() => { navigator.clipboard.writeText(newAgentToken); }}
                className="text-xs text-text-muted hover:text-text shrink-0"
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {newToken && (
          <div className="mb-4 p-3 bg-accent/10 border border-accent/20 rounded-lg">
            <p className="text-sm text-text mb-1">New token generated. Save it — it won't be shown again:</p>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono text-accent break-all flex-1">{newToken}</code>
              <button
                onClick={() => { navigator.clipboard.writeText(newToken); }}
                className="text-xs text-text-muted hover:text-text shrink-0"
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {batchResults && (
          <div className="mb-4 p-3 bg-surface-elevated border border-border rounded-lg">
            <p className="text-sm font-medium mb-2">Batch delete results:</p>
            {batchResults.map(r => (
              <div key={r.id} className="text-xs">
                <span className={r.success ? 'text-green-400' : 'text-error'}>
                  {r.success ? '✓' : '✗'}
                </span>{' '}
                <span className="font-mono">{r.id.slice(0, 8)}</span>
                {r.error && <span className="text-error ml-1">— {r.error}</span>}
              </div>
            ))}
            <button onClick={() => setBatchResults(null)} className="text-xs text-text-muted hover:text-text mt-2">dismiss</button>
          </div>
        )}

        {/* Create agent modal */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
            <div className="bg-surface rounded-lg border border-border p-4 w-80" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-medium mb-3">Create New Agent</h3>
              <input
                type="text"
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                placeholder="Agent name (unique)"
                className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent mb-2"
              />
              <input
                type="text"
                value={createDisplayName}
                onChange={e => setCreateDisplayName(e.target.value)}
                placeholder="Display name (optional)"
                className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent mb-3"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm text-text-muted hover:text-text">Cancel</button>
                <button
                  onClick={handleCreate}
                  disabled={!createName.trim()}
                  className="px-3 py-1.5 text-sm font-medium bg-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>

        {/* Agent list */}
        <div className="bg-surface rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-elevated">
                <th className="p-3 text-left w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === agents.length && agents.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded"
                  />
                </th>
                <th className="p-3 text-left text-text-muted font-medium">Name</th>
                <th className="p-3 text-left text-text-muted font-medium">Display Name</th>
                <th className="p-3 text-left text-text-muted font-medium">Status</th>
                <th className="p-3 text-left text-text-muted font-medium">Created</th>
                <th className="p-3 text-right text-text-muted font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="p-6 text-center text-text-muted">Loading...</td></tr>
              ) : agents.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-text-muted">No agents found</td></tr>
              ) : agents.map(a => (
                <tr key={a.id} className="border-b border-border last:border-0 hover:bg-surface-elevated/50">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggleSelect(a.id)}
                      className="rounded"
                    />
                  </td>
                  <td className="p-3">
                    {editId === a.id ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="w-full px-2 py-1 bg-surface-elevated border border-border rounded text-sm text-text focus:outline-none focus:border-accent"
                      />
                    ) : (
                      <span className="font-mono text-text">{a.name}</span>
                    )}
                  </td>
                  <td className="p-3">
                    {editId === a.id ? (
                      <input
                        type="text"
                        value={editDisplayName}
                        onChange={e => setEditDisplayName(e.target.value)}
                        className="w-full px-2 py-1 bg-surface-elevated border border-border rounded text-sm text-text focus:outline-none focus:border-accent"
                      />
                    ) : (
                      <span className="text-text-muted">{a.display_name || '—'}</span>
                    )}
                  </td>
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs ${
                      a.status === 'online' ? 'text-green-400' :
                      a.status === 'busy' ? 'text-yellow-400' :
                      a.status === 'idle' ? 'text-blue-400' : 'text-text-muted'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        a.status === 'online' ? 'bg-green-400' :
                        a.status === 'busy' ? 'bg-yellow-400' :
                        a.status === 'idle' ? 'bg-blue-400' : 'bg-text-muted'
                      }`} />
                      {a.status}
                    </span>
                  </td>
                  <td className="p-3 text-text-muted text-xs">
                    {new Date(a.created_at).toLocaleDateString()}
                  </td>
                  <td className="p-3 text-right">
                    {editId === a.id ? (
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => handleSave(a.id)} className="px-2 py-1 text-xs text-accent hover:underline">Save</button>
                        <button onClick={() => setEditId(null)} className="px-2 py-1 text-xs text-text-muted hover:text-text">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => handleEdit(a)} className="px-2 py-1 text-xs text-text-muted hover:text-accent">Edit</button>
                        <button onClick={() => handleRegenerateToken(a.id)} className="px-2 py-1 text-xs text-text-muted hover:text-accent">Token</button>
                        <button onClick={() => handleDelete(a.id)} className="px-2 py-1 text-xs text-text-muted hover:text-error">Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
