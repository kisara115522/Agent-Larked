import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { get, post } from '../api/client';
import { AgentAvatar } from '../components/agent/AgentAvatar';
import { StatusIndicator } from '../components/agent/StatusIndicator';

interface Room {
  id: string;
  name: string;
  member_count: number;
}

interface Agent {
  id: string;
  name: string;
  display_name: string;
  status: string;
  capabilities: string[];
}

export function CommandPage() {
  const { token } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedRoom, setSelectedRoom] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('');
  const [command, setCommand] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState('');

  useEffect(() => {
    if (!token) return;
    get<{ rooms: Room[] }>('/rooms', token).then(r => setRooms(r.rooms)).catch(() => {});
    get<{ agents: Agent[] }>('/agents', token).then(r => setAgents(r.agents)).catch(() => {});
  }, [token]);

  const handleSend = async () => {
    if (!token || !selectedRoom || !command.trim()) return;
    setSending(true);
    setResult('');
    try {
      const mentions = selectedAgent ? [selectedAgent] : undefined;
      await post('/messages', token, {
        room_id: selectedRoom,
        content: command.trim(),
        mentions,
        idempotency_key: crypto.randomUUID(),
      });
      setResult('Command sent successfully!');
      setCommand('');
    } catch (err) {
      setResult(`Error: ${(err as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-border shrink-0">
        <h2 className="text-lg font-semibold">🎯 Command Center</h2>
        <p className="text-sm text-text-muted">Assign tasks to agents via @mention</p>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <label className="block text-xs text-text-muted uppercase tracking-wider mb-2">Target Room</label>
            <select
              value={selectedRoom}
              onChange={e => setSelectedRoom(e.target.value)}
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text outline-none focus:border-accent"
            >
              <option value="">Select a room...</option>
              {rooms.map(r => (
                <option key={r.id} value={r.id}>💬 {r.name} ({r.member_count} members)</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-text-muted uppercase tracking-wider mb-2">Target Agent (optional)</label>
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
              {agents.map(a => (
                <button
                  key={a.id}
                  onClick={() => setSelectedAgent(selectedAgent === a.id ? '' : a.id)}
                  className={`flex items-center gap-2 p-2 rounded-lg text-sm transition-colors ${
                    selectedAgent === a.id
                      ? 'bg-accent-muted border border-accent'
                      : 'bg-surface-elevated border border-border hover:border-text-muted'
                  }`}
                >
                  <AgentAvatar name={a.name} displayName={a.display_name} size="sm" />
                  <span className="truncate">{a.display_name || a.name}</span>
                  <StatusIndicator status={a.status as 'online' | 'busy' | 'idle' | 'offline'} />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-muted uppercase tracking-wider mb-2">Command</label>
            <textarea
              value={command}
              onChange={e => setCommand(e.target.value)}
              placeholder={selectedAgent ? `@${agents.find(a => a.id === selectedAgent)?.name ?? 'agent'} please...` : 'Type your command...'}
              rows={4}
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text outline-none focus:border-accent resize-none"
            />
          </div>

          <button
            onClick={handleSend}
            disabled={!selectedRoom || !command.trim() || sending}
            className="w-full px-4 py-2.5 bg-accent text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {sending ? 'Sending...' : 'Send Command'}
          </button>

          {result && (
            <p className={`text-sm ${result.startsWith('Error') ? 'text-error' : 'text-success'}`}>
              {result}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
