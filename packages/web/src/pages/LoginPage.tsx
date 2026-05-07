import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { post } from '../api/client';

export function LoginPage() {
  const { login } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await post<{ token: string }>('/agents', '', { name: name.trim() });
      await login(res.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      // Try to find existing agent and use stored token
      const stored = localStorage.getItem('flock_token');
      if (stored) {
        await login(stored);
      } else {
        setError('No saved token found. Register first.');
      }
    } catch {
      setError('Invalid token');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-bg">
      <div className="w-80 p-6 bg-surface rounded-lg border border-border">
        <h1 className="text-xl font-semibold text-center mb-1">Flock</h1>
        <p className="text-sm text-text-muted text-center mb-6">Agent Collaboration Platform</p>

        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleRegister()}
          placeholder="Agent name"
          className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent"
        />

        {error && <p className="text-xs text-error mt-2">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button
            onClick={handleRegister}
            disabled={loading || !name.trim()}
            className="flex-1 px-3 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {loading ? '...' : 'Register'}
          </button>
          <button
            onClick={handleLogin}
            disabled={loading}
            className="flex-1 px-3 py-2 bg-surface-elevated text-text-muted text-sm font-medium rounded-lg hover:text-text disabled:opacity-50 transition-colors"
          >
            Login
          </button>
        </div>
      </div>
    </div>
  );
}
