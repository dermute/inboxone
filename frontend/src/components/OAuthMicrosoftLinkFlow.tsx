import { useState } from "react";

import { useMicrosoftOAuthFlow } from "../api/useMicrosoftOAuth";

export default function OAuthMicrosoftLinkFlow({
  onDone,
  reconnectAccountId,
}: {
  onDone: () => void;
  reconnectAccountId?: number;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#0F6CBD");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [clientId, setClientId] = useState("");
  const { start, poll, flowId } = useMicrosoftOAuthFlow(reconnectAccountId);

  if (poll.data?.status === "complete") {
    return (
      <div className="space-y-3 text-sm">
        <p className="font-medium text-green-700 dark:text-green-400">
          {reconnectAccountId ? "Reconnected successfully." : "Account linked successfully."}
        </p>
        <button onClick={onDone} className="glass-button-primary">
          Done
        </button>
      </div>
    );
  }

  if (flowId && start.data) {
    return (
      <div className="space-y-3 text-sm">
        {poll.data?.status === "error" ? (
          <p className="text-red-600">{poll.data.error}</p>
        ) : (
          <>
            <p>
              Go to{" "}
              <a
                href={start.data.verification_uri}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-600 underline"
              >
                {start.data.verification_uri}
              </a>{" "}
              and enter this code:
            </p>
            <p className="glass-card px-4 py-3 text-center text-xl font-mono tracking-widest">
              {start.data.user_code}
            </p>
            <p className="text-gray-600 dark:text-gray-400">Waiting for you to complete sign-in...</p>
          </>
        )}
      </div>
    );
  }

  if (reconnectAccountId) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-gray-600 dark:text-gray-400">
          Sign in again to refresh this account's connection - useful if sign-in has expired or
          been revoked. You'll get a code to enter at microsoft.com/devicelogin.
        </p>
        {start.isError && <p className="text-red-600">Failed to start sign-in.</p>}
        <button
          onClick={() => start.mutate({})}
          disabled={start.isPending}
          className="glass-button-primary"
        >
          {start.isPending ? "Starting..." : "Reconnect"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-gray-600 dark:text-gray-400">
        Works with any outlook.com, hotmail.com, live.com, or Microsoft 365 account - no Azure
        setup needed. You'll get a code to enter at microsoft.com/devicelogin.
      </p>
      <div className="flex items-center gap-2">
        <span className="w-20 text-gray-600 dark:text-gray-400">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className="input flex-1" />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-20 text-gray-600 dark:text-gray-400">Color</span>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-8 w-14 rounded-lg border border-black/10 bg-white/70 dark:border-white/10 dark:bg-white/10"
        />
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced((s) => !s)}
        className="text-xs font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
      >
        {showAdvanced ? "Hide advanced options" : "Advanced: use my own Azure app"}
      </button>
      {showAdvanced && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Only needed if you'd rather isolate this account under your own Azure AD app
            registration instead of inboxone's built-in one. See the README for the one-time
            setup steps (multi-tenant + personal accounts, public client flows enabled, delegated
            scopes IMAP.AccessAsUser.All / Mail.Send / offline_access / User.Read).
          </p>
          <div className="flex items-center gap-2">
            <span className="w-20 text-gray-600 dark:text-gray-400">Client ID</span>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Azure AD application (client) ID"
              className="input flex-1"
            />
          </div>
        </div>
      )}

      {start.isError && <p className="text-red-600">Failed to start sign-in.</p>}
      <button
        onClick={() =>
          start.mutate({ name, color, client_id: clientId || undefined, tenant: "common" })
        }
        disabled={!name || start.isPending}
        className="glass-button-primary"
      >
        {start.isPending ? "Starting..." : "Connect Microsoft account"}
      </button>
    </div>
  );
}
