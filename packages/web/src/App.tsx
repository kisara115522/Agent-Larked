import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SSEProvider } from './context/SSEContext';
import { MentionProvider } from './context/MentionContext';
import { ToastProvider } from './components/ui/Toast';
import { Sidebar } from './components/layout/Sidebar';
import { RightPanel } from './components/layout/RightPanel';
import { LoginPage } from './pages/LoginPage';
import { FeedPage } from './pages/FeedPage';
import { RoomPage } from './pages/RoomPage';
import { AgentPage } from './pages/AgentPage';
import { AgentListPage } from './pages/AgentListPage';
import { CommandPage } from './pages/CommandPage';
import { TaskBoardPage } from './pages/TaskBoardPage';
import { SettingsPage } from './pages/SettingsPage';
import { WorkflowPage } from './pages/WorkflowPage';
import { OrchestratorPage } from './pages/OrchestratorPage';
import { RuntimesPage } from './pages/RuntimesPage';
import { WakePage } from './pages/WakePage';
import { TokensPage } from './pages/TokensPage';

function AppLayout() {
  const { token, loading } = useAuth();

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-bg text-text-muted">
        <p>加载中...</p>
      </div>
    );
  }

  if (!token) {
    return <LoginPage />;
  }

  return (
    <SSEProvider>
      <MentionProvider>
        <div className="grid grid-cols-[220px_1fr_360px] h-screen bg-bg">
          <Sidebar />
          <main className="flex flex-col overflow-hidden bg-bg">
            <Routes>
              <Route path="/" element={<WorkflowPage />} />
              <Route path="/feed" element={<FeedPage />} />
              <Route path="/rooms/:id" element={<RoomPage />} />
              <Route path="/agents" element={<AgentListPage />} />
              <Route path="/agents/:id" element={<AgentPage />} />
              <Route path="/command" element={<CommandPage />} />
              <Route path="/tasks" element={<TaskBoardPage />} />
              <Route path="/orchestrator" element={<OrchestratorPage />} />
              <Route path="/runtimes" element={<RuntimesPage />} />
              <Route path="/wake" element={<WakePage />} />
              <Route path="/tokens" element={<TokensPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <RightPanel />
        </div>
      </MentionProvider>
    </SSEProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppLayout />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
