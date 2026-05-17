import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SSEProvider } from './context/SSEContext';
import { MentionProvider } from './context/MentionContext';
import { Sidebar } from './components/layout/Sidebar';
import { LoginPage } from './pages/LoginPage';
import { FeedPage } from './pages/FeedPage';
import { RoomPage } from './pages/RoomPage';
import { AgentPage } from './pages/AgentPage';
import { AgentListPage } from './pages/AgentListPage';
import { CommandPage } from './pages/CommandPage';
import { TaskBoardPage } from './pages/TaskBoardPage';
import { SettingsPage } from './pages/SettingsPage';

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
      <MentionProvider>
        <div className="flex h-screen bg-bg">
          <Sidebar />
          <main className="flex-1 overflow-hidden">
            <Routes>
              <Route path="/" element={<FeedPage />} />
              <Route path="/rooms/:id" element={<RoomPage />} />
              <Route path="/agents" element={<AgentListPage />} />
              <Route path="/agents/:id" element={<AgentPage />} />
              <Route path="/command" element={<CommandPage />} />
            <Route path="/tasks" element={<TaskBoardPage />} />
            <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </MentionProvider>
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
