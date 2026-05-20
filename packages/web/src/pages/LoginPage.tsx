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
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const clear = () => { setError(''); setUsername(''); setPassword(''); setDisplayName(''); setConfirmPassword(''); };

  const handleRegister = async () => {
    if (!username.trim() || !password.trim()) return;
    if (password !== confirmPassword) { setError('两次密码不一致'); return; }
    setLoading(true); setError('');
    try {
      const res = await post<{ id: string; token: string }>('/human/register', '', {
        username: username.trim(), password: password.trim(),
        display_name: displayName.trim() || username.trim(),
      });
      await login(res.token);
    } catch (err) { setError((err as Error).message || '注册失败'); }
    finally { setLoading(false); }
  };

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) return;
    setLoading(true); setError('');
    try {
      const res = await post<{ id: string; token: string }>('/human/login', '', {
        username: username.trim(), password: password.trim(),
      });
      await login(res.token);
    } catch (err) { setError((err as Error).message || '登录失败'); }
    finally { setLoading(false); }
  };

  const submit = mode === 'login' ? handleLogin : handleRegister;

  return (
    <div className="h-screen flex items-center justify-center bg-bg">
      <div className="w-[380px]" style={{ animation: 'fadeUp .4s ease-out' }}>
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-3">
          <div className="w-11 h-11 rounded-[10px] flex items-center justify-center bg-accent">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <circle cx="4" cy="8" r="2.5" fill="white" opacity="0.9"/>
              <circle cx="12" cy="4" r="2" fill="white" opacity="0.7"/>
              <circle cx="12" cy="12" r="2" fill="white" opacity="0.7"/>
              <line x1="6.2" y1="7.1" x2="10.2" y2="4.8" stroke="white" strokeWidth="1.2" opacity="0.5"/>
              <line x1="6.2" y1="8.9" x2="10.2" y2="11.2" stroke="white" strokeWidth="1.2" opacity="0.5"/>
            </svg>
          </div>
          <span className="text-[26px] font-bold tracking-tight">Flock</span>
        </div>
        <p className="text-center text-[13px] text-text-dim mb-10 font-medium">Agent 协作控制中心</p>

        <div className="bg-surface border border-border rounded-[14px] p-8">
          {/* Mode toggle */}
          <div className="flex mb-7 rounded-full p-[3px] bg-surface-elevated">
            {(['login', 'register'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); clear(); }}
                className={`flex-1 py-2.5 text-[13px] font-semibold rounded-full transition-colors duration-150 ${
                  mode === m ? 'bg-accent text-white' : 'text-text-muted hover:text-text'
                }`}
              >
                {m === 'login' ? '登录' : '注册'}
              </button>
            ))}
          </div>

          {/* Form */}
          <div className="space-y-3">
            <LoginInput type="text" value={username} onChange={setUsername} onSubmit={submit} placeholder="用户名" autoFocus />
            {mode === 'register' && (
              <LoginInput type="text" value={displayName} onChange={setDisplayName} onSubmit={submit} placeholder="显示名称" />
            )}
            <LoginInput type="password" value={password} onChange={setPassword} onSubmit={submit} placeholder="密码" />
            {mode === 'register' && (
              <LoginInput type="password" value={confirmPassword} onChange={setConfirmPassword} onSubmit={submit} placeholder="确认密码" />
            )}
          </div>

          {error && (
            <p className="text-[12px] text-error mt-4 flex items-center gap-2" style={{ animation: 'fadeUp .15s ease-out' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-error shrink-0" />
              {error}
            </p>
          )}

          <button
            onClick={submit}
            disabled={loading || !username.trim() || !password.trim()}
            className="w-full mt-6 px-4 py-3 bg-accent text-white text-[14px] font-semibold rounded-[10px] hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                处理中
              </span>
            ) : mode === 'login' ? '登录' : '注册'}
          </button>

          <p className="text-center text-[12px] text-text-dim mt-6">
            {mode === 'login' ? '没有账号？' : '已有账号？'}
            <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); clear(); }} className="text-accent hover:text-accent-hover ml-1 font-medium transition-colors">
              {mode === 'login' ? '注册' : '登录'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

function LoginInput({ type, value, onChange, onSubmit, placeholder, autoFocus }: {
  type: string; value: string; onChange: (v: string) => void;
  onSubmit: () => void; placeholder: string; autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => e.key === 'Enter' && onSubmit()}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className="input"
    />
  );
}
