import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "../api/client";
import { useAuth } from "../api/useAuth";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync(password);
      navigate("/inbox");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="glass-panel w-full max-w-sm p-8">
        <h1 className="mb-1 text-2xl font-semibold">inboxone</h1>
        <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
          Enter the app password to continue.
        </p>
        <label htmlFor="app-password" className="sr-only">
          App password
        </label>
        <input
          id="app-password"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
          className="input mb-3 py-2"
        />
        {error && (
          <p id="login-error" role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <button type="submit" disabled={login.isPending} className="glass-button-primary w-full">
          {login.isPending ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
