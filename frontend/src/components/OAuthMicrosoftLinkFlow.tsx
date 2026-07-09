import { useState } from "react";

import { useMicrosoftOAuthFlow } from "../api/useMicrosoftOAuth";

export default function OAuthMicrosoftLinkFlow({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#0F6CBD");
  const [clientId, setClientId] = useState("");
  const { start, poll, flowId } = useMicrosoftOAuthFlow();

  if (poll.data?.status === "complete") {
    return (
      <div className="space-y-3 text-sm">
        <p className="font-medium text-green-600">Account linked successfully.</p>
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
            <p className="text-gray-500">Waiting for you to complete sign-in...</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-gray-500">
        Requires a free Azure AD app registration - see the README for the one-time setup steps
        (multi-tenant + personal accounts, public client flows enabled, delegated scopes
        IMAP.AccessAsUser.All / Mail.Send / offline_access / User.Read).
      </p>
      <div className="flex items-center gap-2">
        <span className="w-20 text-gray-500">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className="input flex-1" />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-20 text-gray-500">Color</span>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-8 w-14 rounded-lg border border-white/60 bg-white/40 dark:border-white/10"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-20 text-gray-500">Client ID</span>
        <input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="Azure AD application (client) ID"
          className="input flex-1"
        />
      </div>
      {start.isError && <p className="text-red-600">Failed to start sign-in.</p>}
      <button
        onClick={() => start.mutate({ name, color, client_id: clientId, tenant: "common" })}
        disabled={!name || !clientId || start.isPending}
        className="glass-button-primary"
      >
        {start.isPending ? "Starting..." : "Connect Microsoft account"}
      </button>
    </div>
  );
}
