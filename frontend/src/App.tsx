import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "./api/useAuth";
import NewMailWatcher from "./components/NewMailWatcher";
import StatusBar from "./components/StatusBar";
import LiveUpdates from "./components/LiveUpdates";
import TabUnreadIndicator from "./components/TabUnreadIndicator";
import Toaster from "./components/Toaster";
import InboxPage from "./pages/InboxPage";
import LoginPage from "./pages/LoginPage";
import SettingsAccountsPage from "./pages/SettingsAccountsPage";
import { navigationRef } from "./store/navigation";

function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    navigationRef.current = navigate;
  }, [navigate]);

  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return (
    <>
      <div className="flex h-dvh flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto"><Outlet /></div>
        <StatusBar />
        <LiveUpdates />
      </div>
      <NewMailWatcher />
      <TabUnreadIndicator />
      <Toaster />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/settings/accounts" element={<SettingsAccountsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
