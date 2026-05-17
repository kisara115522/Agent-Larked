import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { post } from '../api/client';

type Mode = 'login' | 'register';

export function LoginPage() {
  const { login } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const clear = () => { setError(''); setUsername(''); setPassword(''); setDisplayName(''); };

  const handleRegister = async () => {
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await post<{ id: string; token: string }>('/human/register', '', {
        username: username.trim(),
        password: password.trim(),
        display_name: displayName.trim() || username.trim(),
      });
      await login(res.token);
    } catch (err) {
      setError((err as Error).message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await post<{ id: string; token: string }>('/human/login', '', {
        username: username.trim(),
        password: password.trim(),
      });
      await login(res.token);
    } catch (err) {
      setError((err as Error).message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-bg">
      <div className="w-[380px] p-12 px-10 bg-surface border border-border rounded-[14px] text-center">
        <h1 className="text-[28px] font-bold tracking-tight">Flock</h1>
        <p className="text-[13px] text-text-muted mb-8">Agent Live Control Room</p>

        {/* Mode tabs */}
        <div className="flex mb-6 bg-bg rounded-full p-[3px]">
          {(['login', 'register'] as const).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); clear(); }}
              className={`flex-1 py-2 text-[13px] font-medium rounded-full transition-colors ${
                mode === m ? 'bg-surface text-text' : 'text-text-muted hover:text-text'
              }`}
            >
              {m === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        {mode === 'login' && (
          <>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="用户名"
              className="w-full px-3.5 py-2.5 bg-surface border border-border rounded-[14px] text-sm text-text placeholder:text-text-dim focus:border-accent mb-3 text-left"
            />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="密码"
              className="w-full px-3.5 py-2.5 bg-surface border border-border rounded-[14px] text-sm text-text placeholder:text-text-dim focus:border-accent text-left"
            />
            {error && <p className="text-xs text-error mt-2 text-left">{error}</p>}
            <button
              onClick={handleLogin}
              disabled={loading || !username.trim() || !password.trim()}
              className="w-full mt-2 px-3 py-3 bg-accent text-white text-[13px] font-semibold rounded-full hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {loading ? '...' : '登录'}
            </button>
          </>
        )}

        {mode === 'register' && (
          <>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRegister()}
              placeholder="用户名"
              className="w-full px-3.5 py-2.5 bg-surface border border-border rounded-[14px] text-sm text-text placeholder:text-text-dim focus:border-accent mb-3 text-left"
            />
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRegister()}
              placeholder="显示名称"
              className="w-full px-3.5 py-2.5 bg-surface border border-border rounded-[14px] text-sm text-text placeholder:text-text-dim focus:border-accent mb-3 text-left"
            />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRegister()}
              placeholder="密码"
              className="w-full px-3.5 py-2.5 bg-surface border border-border rounded-[14px] text-sm text-text placeholder:text-text-dim focus:border-accent mb-3 text-left"
            />
            <input
              type="password"
              value=""
              onChange={() => {}}
              placeholder="确认密码"
              className="w-full px-3.5 py-2.5 bg-surface border border-border rounded-[14px] text-sm text-text placeholder:text-text-dim focus:border-accent text-left"
            />
            {error && <p className="text-xs text-error mt-2 text-left">{error}</p>}
            <button
              onClick={handleRegister}
              disabled={loading || !username.trim() || !password.trim()}
              className="w-full mt-2 px-3 py-3 bg-accent text-white text-[13px] font-semibold rounded-full hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {loading ? '...' : '注册'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
