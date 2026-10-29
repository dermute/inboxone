import { beginWork, refreshActivity, type WorkDescription } from "../store/activityStore";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  activity?: WorkDescription | false;
  signal?: AbortSignal;
  binary?: boolean;
}

function describe(path: string, method = "GET"): WorkDescription | undefined {
  const url = new URL(path, window.location.origin);
  const account_id = Number(url.searchParams.get("account_id")) || undefined;
  const folder_id = Number(url.searchParams.get("folder_id")) || undefined;
  if (url.pathname === "/api/sync/trigger" || url.pathname === "/api/sync/retry") {
    return { label: folder_id ? "Refreshing folder…" : "Refreshing accounts…", kind: "sync", account_id, folder_id };
  }
  const message = url.pathname.match(/^\/api\/messages\/(\d+)(?:\/(.*))?$/);
  if (message) {
    const message_id = Number(message[1]);
    const action = message[2];
    if (action === "reply" || action === "forward") return { label: "Sending…", kind: "send", message_id };
    if (action?.startsWith("attachments/")) return { label: "Downloading attachment…", kind: "attachment", message_id };
    if (action === "flags") return { label: "Updating read status…", kind: "flags", message_id };
    if (method === "DELETE") return { label: "Deleting message…", kind: "delete", message_id };
    return { label: "Opening message…", kind: "message", message_id };
  }
  if (url.pathname === "/api/messages/mark-all-read") {
    return { label: "Updating read status…", kind: "flags", account_id, folder_id };
  }
  if (url.pathname === "/api/messages" && !url.searchParams.has("notifications_only")) {
    return { label: url.searchParams.has("cursor") ? "Loading more messages…" : "Loading messages…", kind: "list", priority: 25, account_id, folder_id };
  }
  const account = url.pathname.match(/^\/api\/accounts\/(\d+)(?:\/(.*))?$/);
  if (account) {
    const account_id = Number(account[1]);
    if (account[2] === "test-connection") return { label: "Testing connection…", kind: "test", account_id };
    if (method !== "GET") return { label: method === "DELETE" ? "Removing account…" : "Saving account…", kind: "account", account_id };
    if (account[2] === "folders") return { label: "Loading folders…", kind: "folders", account_id };
  }
  if (url.pathname === "/api/accounts" && method === "POST") return { label: "Adding account…", kind: "account" };
}

async function request<T>(path: string, init?: RequestInit, options?: RequestOptions): Promise<T> {
  const work = options?.activity === false ? undefined : options?.activity ?? describe(path, init?.method);
  const finish = work ? beginWork(work) : () => {};
  try {
    const result = await performRequest<T>(path, { ...init, signal: options?.signal }, options?.binary);
    // A queued sync outlives its HTTP request. Hand feedback to an authoritative
    // activity snapshot before removing the local action's immediate indicator.
    if (work?.kind === "sync") await refreshActivity();
    return result;
  } finally {
    finish();
  }
}

async function performRequest<T>(path: string, init?: RequestInit, binary = false): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (binary ? res.blob() : res.json()) as Promise<T>;
}

export const api = {
  download: (path: string) => request<Blob>(path, undefined, { binary: true }),
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }, options),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
