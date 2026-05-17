import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SSEProvider } from './context/SSEContext';
import { Sidebar } from './components/layout/Sidebar';
import { LoginPage } from './pages/LoginPage';
import { FeedPage } from './pages/FeedPage';
import { RoomPage } from './pages/RoomPage';
import { AgentPage } from './pages/AgentPage';
import { AgentListPage } from './pages/AgentListPage';
import { CommandPage } from './pages/CommandPage';

function AppLayout() {
  const { token, loading } = useAuth();

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-bg text-text-muted">
        <p>Loading...</p>
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
            <Route path="/agents" element={<AgentListPage />} />
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
        <AppLayout />
      </AuthProvider>
    </BrowserRouter>
  );
}
