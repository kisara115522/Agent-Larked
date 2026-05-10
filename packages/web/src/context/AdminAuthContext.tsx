import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { get } from '../api/client';

interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  role: string;
}

interface AdminAuthState {
  adminToken: string | null;
  adminUser: AdminUser | null;
  adminLoading: boolean;
}

interface AdminAuthContextValue extends AdminAuthState {
  adminLogin: (token: string) => Promise<void>;
  adminLogout: () => void;
  isAdmin: boolean;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

const ADMIN_TOKEN_KEY = 'flock_admin_token';

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdminAuthState>({
    adminToken: localStorage.getItem(ADMIN_TOKEN_KEY),
    adminUser: null,
    adminLoading: true,
  });

  const loadAdmin = useCallback(async (token: string) => {
    try {
      const user = await get<AdminUser>('/admin/me', token);
      setState({ adminToken: token, adminUser: user, adminLoading: false });
    } catch {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      setState({ adminToken: null, adminUser: null, adminLoading: false });
    }
  }, []);

  useEffect(() => {
    if (state.adminToken) {
      loadAdmin(state.adminToken);
    } else {
      setState(s => ({ ...s, adminLoading: false }));
    }
  }, [state.adminToken, loadAdmin]);

  const adminLogin = useCallback(async (token: string) => {
    // Verify token by calling /admin/me
    const user = await get<AdminUser>('/admin/me', token);
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
    setState({ adminToken: token, adminUser: user, adminLoading: false });
  }, []);

  const adminLogout = useCallback(() => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setState({ adminToken: null, adminUser: null, adminLoading: false });
  }, []);

  return (
    <AdminAuthContext.Provider value={{
      ...state,
      adminLogin,
      adminLogout,
      isAdmin: !!state.adminToken && !!state.adminUser,
    }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}
