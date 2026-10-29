import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { receiveActivity, refreshActivity } from "../store/activityStore";
import { useLiveSync } from "../api/liveSync";

// Mounted once in the authenticated shell, including Settings and hidden pages.
export default function LiveUpdates() {
  const cache = useQueryClient();
  useEffect(() => {
    const clientId = globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let disposed = false;
    const invalidate = () => {
      void cache.invalidateQueries({ queryKey: ["messages"] });
      void cache.invalidateQueries({ queryKey: ["accounts"] });
      void cache.invalidateQueries({ queryKey: ["connections"] });
    };
    const refresh = () => {
      void api.post("/api/sync/trigger").catch(() => {});
    };
    const presence = (refreshVisible = false) => {
      const visible = document.visibilityState === "visible";
      void api.post("/api/sync/presence", { client_id: clientId, visible }).catch(() => {});
      if (visible && refreshVisible) {
        void refreshActivity();
        invalidate();
        refresh();
      }
    };
    const onVisibility = () => presence(true);
    const onPageHide = () => {
      void fetch("/api/sync/presence", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, keepalive: true,
        body: JSON.stringify({ client_id: clientId, visible: false }) }).catch(() => {});
    };
    let stream: EventSource | undefined;
    let reconnectTimer: number | undefined;
    const connect = () => {
      if (disposed) return;
      const connection = new EventSource("/api/sync/events");
      stream = connection;
      connection.onopen = () => {
        if (disposed) return;
        useLiveSync.setState({ connected: true });
        invalidate();
      };
      connection.onmessage = (event) => {
        if (disposed) return;
        const data = JSON.parse(event.data);
        if (data.type === "activity" || data.type === "snapshot") receiveActivity(data.items ?? []);
        if (data.type === "snapshot" || data.type === "folder" || data.type === "folders") {
          invalidate();
        } else if (data.type !== "activity") {
          void cache.invalidateQueries({ queryKey: ["connections"] });
        }
      };
      connection.onerror = () => {
        if (disposed) return;
        // Some HTTP failures permanently close EventSource. Own the retry timer
        // so both initial connection failures and interrupted streams recover.
        connection.close();
        useLiveSync.setState({ connected: false });
        receiveActivity([]);
        if (document.visibilityState === "visible") void refreshActivity();
        reconnectTimer = window.setTimeout(connect, 3_000);
      };
    };
    connect();
    presence(true);
    const lease = window.setInterval(() => {
      if (document.visibilityState === "visible") presence();
    }, 20_000);
    const fallback = window.setInterval(() => {
      if (!useLiveSync.getState().connected) invalidate();
    }, 60_000);
    const activityFallback = window.setInterval(() => {
      if (!useLiveSync.getState().connected && document.visibilityState === "visible") {
        void refreshActivity();
      }
    }, 2_000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onVisibility);
    return () => {
      disposed = true;
      stream?.close();
      window.clearTimeout(reconnectTimer);
      useLiveSync.setState({ connected: false });
      window.clearInterval(lease);
      window.clearInterval(fallback);
      window.clearInterval(activityFallback);
      receiveActivity([]);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onVisibility);
      onPageHide();
    };
  }, [cache]);
  return null;
}
