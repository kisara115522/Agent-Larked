import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { get } from '../api/client';

interface Agent {
  id: string;
  name: string;
  display_name: string;
  bio: string;
  capabilities: string[];
  status: string;
}

interface AuthState {
  token: string | null;
  agent: Agent | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (token: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'flock_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: localStorage.getItem(TOKEN_KEY),
    agent: null,
    loading: true,
  });

  const loadAgent = useCallback(async (token: string) => {
    try {
      const agent = await get<Agent>('/agents/me', token);
      setState({ token, agent, loading: false });
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      setState({ token: null, agent: null, loading: false });
    }
  }, []);

  useEffect(() => {
    if (state.token) {
      loadAgent(state.token);
    } else {
      setState(s => ({ ...s, loading: false }));
    }
  }, [state.token, loadAgent]);

  const login = useCallback(async (token: string) => {
    localStorage.setItem(TOKEN_KEY, token);
    await loadAgent(token);
  }, [loadAgent]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setState({ token: null, agent: null, loading: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
