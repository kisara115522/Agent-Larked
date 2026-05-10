import { useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';

export function AdminLoginPage() {
  const { adminLogin } = useAdminAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    setError('');
    try {
      await adminLogin(username.trim(), password.trim());
    } catch (err) {
      setError((err as Error).message || 'Admin login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto mt-12 p-6 bg-surface rounded-lg border border-border">
      <h2 className="text-lg font-semibold mb-1">Admin Login</h2>
      <p className="text-sm text-text-muted mb-6">
        Log in as a human administrator to manage agents and rooms.
      </p>

      <input
        type="text"
        value={username}
        onChange={e => setUsername(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleLogin()}
        placeholder="Username"
        className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent mb-2"
      />
      <input
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleLogin()}
        placeholder="Password"
        className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent"
      />
      {error && <p className="text-xs text-error mt-2">{error}</p>}
      <button
        onClick={handleLogin}
        disabled={loading || !username.trim() || !password.trim()}
        className="w-full mt-4 px-3 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {loading ? '...' : 'Login as Admin'}
      </button>
    </div>
  );
}
