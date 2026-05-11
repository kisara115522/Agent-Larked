import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { get, patch } from '../api/client';
import { clearAgentToken, getAgentToken, storeAgentToken } from './tokenStorage';

interface Agent {
  id: string;
  name: string;
  display_name: string;
  bio: string;
  capabilities: string[];
  status: string;
  is_admin: boolean;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: getAgentToken(),
    agent: null,
    loading: true,
  });

  const loadAgent = useCallback(async (token: string) => {
    try {
      const agent = await get<Agent>('/agents/me', token);
      setState({ token, agent, loading: false });
    } catch {
      clearAgentToken();
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
    storeAgentToken(token);
    await loadAgent(token);
    // Set agent status to online on web login
    try {
      const agent = await get<Agent>('/agents/me', token);
      if (agent.id) {
        await patch(`/agents/${agent.id}`, token, { status: 'online' });
      }
    } catch { /* ignore */ }
  }, [loadAgent]);

  const logout = useCallback(() => {
    clearAgentToken();
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
