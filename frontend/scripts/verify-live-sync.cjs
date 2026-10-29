/* Browser smoke test against the production build and an in-process fake API.
 * Run after npm run build, with playwright-core installed and CHROMIUM_PATH set
 * when Chromium is not managed by Playwright. No real accounts are contacted.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "../dist");
const streams = new Set();
const calls = [];
let health = "green";
let acceptStream = true;
let notificationsOnly = [];
let items = [];
let activities = [];
let pagination = false;
let refreshSeconds = 900;
const failures = new Set();
const held = new Map();
function hold(method, url) {
  let release;
  const key = `${method} ${url}`;
  held.set(key, new Promise((resolve) => { release = resolve; }));
  return () => { held.delete(key); release(); };
}
function activity(items) { activities = items; event("activity", { items }); }

const account = { id: 1, name: "Test mail", color: "#4F46E5", protocol: "imap_basic",
  is_active: true, imap_host: "mail.example.test", folders: [
    { id: 1, imap_path: "INBOX", display_name: "Inbox", is_inbox: true, unread_count: 0 },
    { id: 2, imap_path: "Archive", display_name: "Archive", is_inbox: false, unread_count: 0 },
  ] };
let extraAccounts = [];
const snapshot = () => ({ health, refresh_seconds: refreshSeconds, accounts: [{
  account_id: 1, name: account.name, color: account.color, health, folders: [{
    folder_id: 1, name: "Inbox", is_inbox: true, mode: health === "yellow" ? "polling" : "idle",
    state: health === "red" ? "error" : health === "yellow" ? "polling" : "connected",
    last_success: new Date().toISOString(),
    error: health === "red" ? "Authentication failed. Check credentials or reconnect OAuth." : undefined,
  }] }, ...extraAccounts] });
function event(type, extra = {}) {
  for (const stream of streams) stream.write(`data: ${JSON.stringify({ type, account_id: 1, folder_id: 1, ...extra })}\n\n`);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  calls.push(req.method + " " + req.url);
  if (held.has(req.method + " " + req.url)) await held.get(req.method + " " + req.url);
  if (url.pathname === "/api/sync/events") {
    if (!acceptStream) { res.writeHead(503); res.end(); return; }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write(`data: ${JSON.stringify({ type: "snapshot", status: snapshot(), items: activities })}\n\n`);
    streams.add(res);
    req.on("close", () => streams.delete(res));
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    if (failures.has(req.method + " " + req.url)) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "Mail server unavailable" }));
      return;
    }
    let body = {};
    if (url.pathname === "/api/auth/me") body = { authenticated: true };
    else if (url.pathname === "/api/settings") {
      if (req.method === "PATCH") {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        refreshSeconds = JSON.parse(raw).sync_interval_seconds;
        event("settings");
      }
      body = { sync_interval_seconds: refreshSeconds };
    }
    else if (url.pathname === "/api/accounts") body = [account];
    else if (url.pathname.endsWith("/folders")) body = account.folders;
    else if (url.pathname === "/api/sync/activity") body = { items: activities };
    else if (/^\/api\/messages\/\d+$/.test(url.pathname)) {
      const message = items.find((item) => item.id === Number(url.pathname.split("/").pop()));
      body = { ...message, text_body: "Message body", html_body: null,
        attachments: [{ part_index: "1", filename: "test.txt" }], references: null };
    }
    else if (/\/(reply|forward)$/.test(url.pathname)) body = { sent: true, warning: null };
    else if (url.pathname.endsWith("/attachments/1")) { res.end("attachment"); return; }
    else if (url.pathname === "/api/messages") body = {
      items: url.searchParams.has("notifications_only") ? notificationsOnly : url.searchParams.has("cursor") ? [{ ...items[0], id: 99, subject: "Older mail" }] : items,
      next_cursor: pagination && !url.searchParams.has("cursor") && !url.searchParams.has("notifications_only") ? "next" : null,
    };
    else if (url.pathname === "/api/sync/connections") body = snapshot();
    else if (url.pathname === "/api/sync/trigger") body = { triggered: [1] };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
    return;
  }
  const file = path.join(root, url.pathname === "/" || !path.extname(url.pathname) ? "index.html" : url.pathname);
  const contentType = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html";
  res.writeHead(200, { "Content-Type": contentType });
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH,
    headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (window.top !== window) return; // Keep test mocks out of sandboxed mail frames.
    localStorage.setItem("notifications-enabled", "true");
    window.notificationTitles = [];
    window.Notification = class {
      static permission = "granted";
      constructor(title) { window.notificationTitles.push(title); }
      close() {}
    };
  });
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/inbox`);
    const footer = page.getByRole("contentinfo", { name: "Application status" });
    const status = () => footer.getByRole("button", { name: /^Connection status:/ });
    await page.getByRole("button", { name: "Connection status: Connected" }).waitFor();
    // Allow focus handlers and their immediate requests to settle; SSE stays open.
    await page.waitForTimeout(500);
    const syncCalls = () => calls.filter((call) => call.startsWith("POST /api/sync/trigger"));
    assert(syncCalls().includes("POST /api/sync/trigger"), "opening the app syncs all accounts");
    const mailCalls = () => calls.filter((call) => call.startsWith("GET /api/messages") || call === "GET /api/accounts");
    const beforeFocusSync = syncCalls().length;
    const beforeFocusMail = mailCalls().length;
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("blur"));
      });
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      });
    }
    // Allow focus handlers and their immediate requests to settle; SSE stays open.
    await page.waitForTimeout(500);
    assert.equal(syncCalls().length, beforeFocusSync, "tab return must not sync mail");
    assert.equal(mailCalls().length, beforeFocusMail, "tab return must not reload cached mail");
    assert.equal(await page.getByText("Sync now", { exact: true }).count(), 0);
    // Identical folder names retain mailbox context in both activity views.
    extraAccounts = [{ account_id: 2, name: "Work mail", color: "#22C55E", health, folders: [] }];
    event("connection");
    activity([
      { id: "personal-inbox", label: "Syncing INBOX…", kind: "sync", account_id: 1, folder_id: 1 },
      { id: "work-inbox", label: "Syncing INBOX…", kind: "sync", state: "queued", account_id: 2, folder_id: 3 },
    ]);
    const inboxLabel = footer.getByText("Test mail · Syncing INBOX…", { exact: true });
    await inboxLabel.waitFor();
    assert.equal(await inboxLabel.getAttribute("title"), "Test mail · Syncing INBOX…");
    await status().click();
    const inboxActivity = page.getByRole("region", { name: "Ongoing activity" });
    await inboxActivity.getByText("Test mail · Syncing INBOX…", { exact: true }).waitFor();
    await inboxActivity.getByText("Work mail · Syncing INBOX… (queued)", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    activity([]);
    extraAccounts = [];
    event("connection");
    await footer.getByText("Connected", { exact: true }).waitFor();
    // Historical imports appear in the message cache but never enter notifications.
    const message = { id: 1, account_id: 1, folder_id: 1, account_name: account.name,
      account_color: account.color, subject: "Historical import", from_addr: "sender@example.test",
      date_sent: new Date().toISOString(), is_seen: false, snippet: "Test", to_addrs: [], cc_addrs: [] };
    items = [message];
    event("folder");
    await page.getByText("Historical import", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.notificationTitles), []);
    const arrival = { ...message, id: 2, subject: "Live arrival" };
    items.unshift(arrival);
    notificationsOnly = [arrival];
    account.folders[0].unread_count = 2;
    event("folder");
    await page.getByText("Live arrival", { exact: true }).waitFor();
    await page.getByLabel("2 unread").first().waitFor();
    await page.waitForFunction(() => window.notificationTitles.includes("Live arrival"));
    await page.getByRole("button", { name: "Expand folders for Test mail" }).click();
    const archive = page.getByRole("button", { name: "Archive", exact: true });
    for (let i = 0; i < 2; i++) {
      const release = hold("POST", "/api/sync/trigger?folder_id=2");
      const response = page.waitForResponse((response) => response.url().endsWith("/api/sync/trigger?folder_id=2"));
      await archive.click();
      await footer.getByText("Test mail · Refreshing Archive…", { exact: true }).waitFor();
      // The cached list is still readable and health stays green while busy.
      await page.getByText("Live arrival", { exact: true }).waitFor();
      assert(await status().locator("span").first().evaluate((node) => node.className.includes("bg-green-500")));
      activity([{ id: "queued", label: "Refreshing Archive…", kind: "sync", state: "queued", account_id: 1, folder_id: 2 }]);
      // Local and matching server phases count as one operation.
      assert.equal(await footer.getByText(/more$/).count(), 0);
      release();
      await response;
      await footer.getByText("Test mail · Refreshing Archive…", { exact: true }).waitFor();
      activity([]);
      await footer.getByText("Connected", { exact: true }).waitFor();
    }
    assert.equal(calls.filter((call) => call === "POST /api/sync/trigger?folder_id=2").length, 2);
    // The visible button always refreshes all accounts, even with Archive selected.
    const refreshAll = footer.getByRole("button", { name: "Refresh all", exact: true });
    const beforeManual = syncCalls().length;
    const releaseRefresh = hold("POST", "/api/sync/trigger");
    const manualResponse = page.waitForResponse((response) => response.url().endsWith("/api/sync/trigger"));
    await refreshAll.click();
    await footer.getByText("Refreshing accounts…", { exact: true }).waitFor();
    assert(await refreshAll.isDisabled());
    releaseRefresh();
    await manualResponse;
    await page.waitForFunction(() => !document.querySelector('footer button:last-child')?.disabled);
    assert.equal(syncCalls().length, beforeManual + 1);
    assert.equal(syncCalls().at(-1), "POST /api/sync/trigger");
    failures.add("POST /api/sync/trigger");
    await refreshAll.click();
    await page.getByRole("status").filter({ hasText: "Mail server unavailable" }).waitFor();
    failures.delete("POST /api/sync/trigger");

    // A foreground message fetch takes precedence over a long background sync.
    activity([{ id: "background", label: "Syncing another account…", kind: "sync", account_id: 9 }]);
    let release = hold("GET", "/api/messages/1");
    await page.getByRole("button", { name: /Historical import/ }).click();
    await footer.getByText("Opening message…", { exact: true }).waitFor();
    await footer.getByText("+1 more", { exact: true }).waitFor();
    await status().click();
    const ongoing = page.getByRole("region", { name: "Ongoing activity" });
    await ongoing.getByText("Opening message…", { exact: true }).waitFor();
    await ongoing.getByText("Account #9 · Syncing another account…", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    release();
    await page.getByRole("button", { name: "Reply", exact: true }).waitFor();
    await footer.getByText("Account #9 · Syncing another account…", { exact: true }).waitFor();
    activity([]);

    release = hold("GET", "/api/messages/1/attachments/1");
    await page.getByRole("link", { name: "test.txt" }).click();
    await footer.getByText("Downloading attachment…", { exact: true }).waitFor();
    release();
    await footer.getByText("Connected", { exact: true }).waitFor();

    await page.getByRole("button", { name: "Reply", exact: true }).click();
    release = hold("POST", "/api/messages/1/reply");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Sending…" }).first().waitFor();
    // A modal keeps its own accessible feedback while the footer is behind it.
    release();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await footer.getByText("Connected", { exact: true }).waitFor();

    // Cached mail remains readable while its detail is refreshed.
    await page.getByRole("button", { name: /Live arrival/ }).click();
    await page.getByRole("button", { name: "Reply", exact: true }).waitFor();
    release = hold("GET", "/api/messages/1");
    await page.getByRole("button", { name: /Historical import/ }).click();
    await footer.getByText("Refreshing message…", { exact: true }).waitFor();
    await page.getByRole("heading", { name: "Historical import", exact: true }).waitFor();
    release();
    await footer.getByText("Connected", { exact: true }).waitFor();

    release = hold("POST", "/api/messages/1/flags");
    await page.getByRole("listitem").filter({ hasText: "Historical import" }).getByRole("button", { name: "Mark as read", exact: true }).click();
    await footer.getByText("Updating read status…", { exact: true }).waitFor();
    release();
    await footer.getByText("Connected", { exact: true }).waitFor();

    // Cancelling a cached fetch must remove its local activity immediately.
    await page.getByRole("button", { name: /Live arrival/ }).click();
    await footer.getByText("Connected", { exact: true }).waitFor();
    release = hold("GET", "/api/messages/1");
    await page.getByRole("button", { name: /Historical import/ }).click();
    await footer.getByText("Refreshing message…", { exact: true }).waitFor();
    await page.getByRole("button", { name: /Live arrival/ }).click();
    await footer.getByText("Connected", { exact: true }).waitFor();
    release();

    pagination = true;
    release = hold("GET", "/api/messages?account_id=1&folder_id=2&cursor=next");
    event("folder");
    await footer.getByText("Test mail · Loading more messages…", { exact: true }).waitFor();
    pagination = false;
    release();
    await page.getByText("Older mail", { exact: true }).waitFor();
    await footer.getByText("Connected", { exact: true }).waitFor();

    release = hold("DELETE", "/api/messages/99");
    await page.getByRole("listitem").filter({ hasText: "Older mail" }).getByRole("button", { name: "Delete message" }).click();
    await footer.getByText("Deleting message…", { exact: true }).waitFor();
    release();
    await footer.getByText("Connected", { exact: true }).waitFor();

    for (const [color, label] of [["yellow", "Connecting or polling"], ["red", "Connection error"], ["green", "Connected"]]) {
      health = color;
      event("connection");
      await page.getByRole("button", { name: `Connection status: ${label}` }).waitFor();
      assert(await status().locator("span").first().evaluate((node, color) => node.className.includes(`bg-${color === "yellow" ? "yellow" : color === "red" ? "red" : "green"}-500`), color));
    }
    acceptStream = false;
    for (const stream of streams) stream.end();
    await page.getByRole("button", { name: "Connection status: Connecting or polling" }).waitFor();
    activities = [{ id: "offline-work", label: "Server work while disconnected…", kind: "sync", account_id: 1 }];
    await footer.getByText("Test mail · Server work while disconnected…", { exact: true }).waitFor();
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const activityCalls = calls.filter((call) => call === "GET /api/sync/activity").length;
    await new Promise((resolve) => setTimeout(resolve, 2200));
    assert.equal(calls.filter((call) => call === "GET /api/sync/activity").length, activityCalls);
    activities = [];
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    items.unshift({ ...message, id: 3, subject: "Reconnect catch-up" });
    acceptStream = true;
    await page.getByText("Reconnect catch-up", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Connection status: Connected" }).waitFor();
    await status().click();
    await page.getByRole("dialog", { name: "Connection status" }).waitFor();
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.getByRole("dialog", { name: "Connection status" }).getByRole("button", { name: "Refresh all", exact: true }).click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    assert(calls.includes("POST /api/sync/retry?account_id=1"));
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await status().waitFor();
    const interval = page.getByRole("spinbutton", { name: "Automatic refresh interval in minutes" });
    await page.waitForFunction(() => document.querySelector('input[type="number"]')?.value === "15");
    await interval.fill("30");
    failures.add("PATCH /api/settings");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Could not save refresh interval" }).waitFor();
    failures.delete("PATCH /api/settings");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Refresh interval saved.", { exact: true }).waitFor();
    assert.equal(refreshSeconds, 1800);
    await status().click();
    await page.getByText(/Scheduled refreshes run every 30 minutes/).waitFor();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await page.waitForFunction(() => document.querySelector('input[type="number"]')?.value === "30");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    assert.equal(await page.getByText("Sync every", { exact: true }).count(), 0);
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: /Back to inbox/ }).click();
    failures.add("GET /api/messages/3");
    await page.getByRole("button", { name: /Reconnect catch-up/ }).click();
    await page.getByRole("alert").filter({ hasText: "Mail server unavailable" }).waitFor();
    await footer.getByText("Connected", { exact: true }).waitFor();
    failures.delete("GET /api/messages/3");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.getByRole("heading", { name: "Reconnect catch-up", exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Back to message list", exact: true }).waitFor();
    const bounds = await footer.boundingBox();
    assert(bounds && bounds.y + bounds.height <= 844 && bounds.y > 750);
    const refreshBounds = await refreshAll.boundingBox();
    assert(refreshBounds && refreshBounds.x >= 0 && refreshBounds.x + refreshBounds.width <= 390);
    const beforeMobileRefresh = syncCalls().length;
    await refreshAll.click();
    // Allow focus handlers and their immediate requests to settle; SSE stays open.
    await page.waitForTimeout(500);
    assert.equal(syncCalls().length, beforeMobileRefresh + 1);
    assert.equal(syncCalls().at(-1), "POST /api/sync/trigger");
    await status().click();
    await page.getByRole("dialog", { name: "Connection status" }).waitFor();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label")?.startsWith("Connection status:"));
    assert.deepEqual(errors, []);
    console.log("Browser smoke passed: immediate/queued activity, foreground priority, phase deduplication, cached message refresh, sending, attachments, read status, live updates, status colors, Settings, mobile footer, focus return.");
  } catch (error) {
    console.error("Recent requests:", calls.slice(-20));
    console.error("Footer:", await page.locator("footer").innerText());
    throw error;
  } finally {
    await browser.close();
    for (const stream of streams) stream.end();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
