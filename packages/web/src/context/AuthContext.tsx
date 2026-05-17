import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { get } from '../api/client';
import { clearToken, getToken, storeToken } from './tokenStorage';

interface Human {
  id: string;
  username: string;
  display_name: string;
}

interface AuthState {
  token: string | null;
  human: Human | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (token: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: getToken(),
    human: null,
    loading: true,
  });

  const loadHuman = useCallback(async (token: string) => {
    try {
      const human = await get<Human>('/human/me', token);
      setState({ token, human, loading: false });
    } catch {
      clearToken();
      setState({ token: null, human: null, loading: false });
    }
  }, []);

  useEffect(() => {
    if (state.token) {
      loadHuman(state.token);
    } else {
      setState(s => ({ ...s, loading: false }));
    }
  }, [state.token, loadHuman]);

  const login = useCallback(async (token: string) => {
    storeToken(token);
    await loadHuman(token);
  }, [loadHuman]);

  const logout = useCallback(() => {
    clearToken();
    setState({ token: null, human: null, loading: false });
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
