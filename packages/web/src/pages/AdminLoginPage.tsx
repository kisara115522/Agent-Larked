import { useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';

export function AdminLoginPage() {
  const { adminLogin } = useAdminAuth();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    if (!token.trim()) return;
    setLoading(true);
    setError('');
    try {
      await adminLogin(token.trim());
    } catch (err) {
      setError((err as Error).message || 'Invalid admin token');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto mt-12 p-6 bg-surface rounded-lg border border-border">
      <h2 className="text-lg font-semibold mb-1">Connect Admin</h2>
      <p className="text-sm text-text-muted mb-6">
        Enter your admin token to access the management panel.
        <br />
        <span className="text-xs">Token is saved in browser localStorage.</span>
      </p>

      <input
        type="password"
        value={token}
        onChange={e => setToken(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleConnect()}
        placeholder="Admin token"
        className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent"
      />
      {error && <p className="text-xs text-error mt-2">{error}</p>}
      <button
        onClick={handleConnect}
        disabled={loading || !token.trim()}
        className="w-full mt-4 px-3 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {loading ? '...' : 'Connect'}
      </button>
    </div>
  );
}
