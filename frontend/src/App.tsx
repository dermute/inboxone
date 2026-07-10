import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";

import { useAuth } from "./api/useAuth";
import NewMailWatcher from "./components/NewMailWatcher";
import StatusBar from "./components/StatusBar";
import InboxPage from "./pages/InboxPage";
import LoginPage from "./pages/LoginPage";
import SettingsAccountsPage from "./pages/SettingsAccountsPage";
import { navigationRef } from "./store/navigation";

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    navigationRef.current = navigate;
  }, [navigate]);

  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return (
    <>
      <div className="flex h-screen flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        <StatusBar />
      </div>
      <NewMailWatcher />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/inbox"
          element={
            <RequireAuth>
              <InboxPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings/accounts"
          element={
            <RequireAuth>
              <SettingsAccountsPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
