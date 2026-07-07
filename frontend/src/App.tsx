import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./api/useAuth";
import InboxPage from "./pages/InboxPage";
import LoginPage from "./pages/LoginPage";
import SettingsAccountsPage from "./pages/SettingsAccountsPage";

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
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
