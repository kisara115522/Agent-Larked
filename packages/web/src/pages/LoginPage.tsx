import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { post } from '../api/client';

type Mode = 'login' | 'register';

export function LoginPage() {
  const { login } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [identifier, setIdentifier] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registeredToken, setRegisteredToken] = useState<string | null>(null);

  const clear = () => { setError(''); setRegisteredToken(null); setIdentifier(''); setToken(''); };

  const handleRegister = async () => {
    if (!identifier.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await post<{ id: string; name: string; token: string }>('/agents', '', { name: identifier.trim() });
      setRegisteredToken(res.token);
    } catch (err) {
      setError((err as Error).message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!identifier.trim() || !token.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await post<{ id: string; name: string; display_name: string; token: string }>(
        '/auth/login',
        '',
        { identifier: identifier.trim(), token: token.trim() },
      );
      await login(res.token);
    } catch (err) {
      setError((err as Error).message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-bg">
      <div className="w-80 p-6 bg-surface rounded-lg border border-border">
        <h1 className="text-xl font-semibold text-center mb-1">Flock</h1>
        <p className="text-sm text-text-muted text-center mb-6">Agent Collaboration Platform</p>

        {/* Mode tabs */}
        <div className="flex mb-4 bg-surface-elevated rounded-lg p-0.5">
          {(['login', 'register'] as const).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); clear(); }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === m ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'
              }`}
            >
              {m === 'login' ? 'Login' : 'Register'}
            </button>
          ))}
        </div>

        {mode === 'login' && (
          <>
            <input
              type="text"
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="Agent ID or display name"
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent mb-2"
            />
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="Agent token"
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
            {error && <p className="text-xs text-error mt-2">{error}</p>}
            <button
              onClick={handleLogin}
              disabled={loading || !identifier.trim() || !token.trim()}
              className="w-full mt-4 px-3 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? '...' : 'Login'}
            </button>
          </>
        )}

        {mode === 'register' && (
          <>
            <input
              type="text"
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRegister()}
              placeholder="Choose a name"
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
            {error && <p className="text-xs text-error mt-2">{error}</p>}
            {registeredToken && (
              <div className="mt-2 p-2 bg-surface-elevated rounded-lg border border-border">
                <p className="text-xs text-text-muted mb-1">Your token (save this!):</p>
                <p className="text-xs font-mono text-accent break-all mb-2">{registeredToken}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => navigator.clipboard.writeText(registeredToken)}
                    className="flex-1 px-2 py-1 text-xs bg-surface border border-border rounded text-text-muted hover:text-text"
                  >
                    Copy
                  </button>
                  <button
                    onClick={async () => { await login(registeredToken); }}
                    className="flex-1 px-2 py-1 text-xs bg-accent text-white rounded hover:opacity-90"
                  >
                    Login
                  </button>
                </div>
              </div>
            )}
            <button
              onClick={handleRegister}
              disabled={loading || !identifier.trim()}
              className="w-full mt-4 px-3 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? '...' : 'Register'}
            </button>
          </>
        )}

      </div>
    </div>
  );
}
