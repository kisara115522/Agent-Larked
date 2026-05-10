import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AdminAuthProvider, useAdminAuth } from './context/AdminAuthContext';
import { SSEProvider } from './context/SSEContext';
import { Sidebar } from './components/layout/Sidebar';
import { LoginPage } from './pages/LoginPage';
import { FeedPage } from './pages/FeedPage';
import { RoomPage } from './pages/RoomPage';
import { AgentPage } from './pages/AgentPage';
import { CommandPage } from './pages/CommandPage';
import { AdminPage } from './pages/AdminPage';
import { RoomManagePage } from './pages/RoomManagePage';

const ADMIN_PATHS = ['/admin', '/admin/rooms'];

function AppLayout() {
  const { token, loading } = useAuth();
  const { isAdmin } = useAdminAuth();
  const location = useLocation();
  const isAdminPath = ADMIN_PATHS.some(p => location.pathname.startsWith(p));

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-bg text-text-muted">
        <p>Loading...</p>
      </div>
    );
  }

  // Admin routes are accessible without agent token (admin has own auth)
  if (isAdminPath) {
    return (
      <div className="flex h-screen bg-bg">
        {token && <Sidebar />}
        <main className={`flex-1 overflow-hidden ${!token ? '' : ''}`}>
          <Routes>
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/rooms" element={<RoomManagePage />} />
          </Routes>
        </main>
      </div>
    );
  }

  if (!token) {
    return <LoginPage />;
  }

  return (
    <SSEProvider>
      <div className="flex h-screen bg-bg">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<FeedPage />} />
            <Route path="/rooms/:id" element={<RoomPage />} />
            <Route path="/agents/:id" element={<AgentPage />} />
            <Route path="/command" element={<CommandPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </SSEProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AdminAuthProvider>
          <AppLayout />
        </AdminAuthProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
