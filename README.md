# inboxone

A self-hosted webmail aggregator: one modern inbox view for all your existing mail
accounts (generic IMAP/SMTP providers plus Outlook.com via OAuth2), running entirely
in a single Docker container. inboxone does not upload your mail to a hosted
third-party service. It stores account configuration, encrypted credentials and
tokens, sync state, and message metadata in its local SQLite database; full bodies and
attachments are fetched on demand and are not persisted.

## Features

- Aggregate multiple IMAP/SMTP accounts and Outlook.com into one chronological inbox.
- Color-coded account indicator on every message so you always know which mailbox it
  came from.
- Search cached subject, sender, and recipient metadata across the unified inbox, with
  an unread-only filter.
- Reply to or forward messages from any configured account, from a single aggregated
  view.
- Automatically discover and sync the complete message history of every selectable
  folder, including Sent, Archive, Junk, and Trash. Browse any folder to read its mail.
- Choose “Include in inbox” folders per account. Combined and account inbox views,
  total unread badges, and new-mail notifications include only those folders.
  Standard `INBOX` folders are included by default.
- A single app-wide password gate protects the whole UI.
- Modern three-pane UI (filter rail / message list / reading pane), not an old-school
  webmail look.
- Installable as a desktop app in Microsoft Edge and Chrome, with its own window
  and app icon.

## Architecture (brief)

- **Backend**: Python (FastAPI), SQLAlchemy async + SQLite, supervised background
  IMAP IDLE and reconciliation, `IMAPClient` for IMAP, `aiosmtplib` for basic-auth SMTP sending, `msal`
  for Microsoft OAuth2 device-code sign-in, Microsoft Graph for sending mail from
  Outlook accounts.
- **Frontend**: React + TypeScript + Vite + TailwindCSS + TanStack Query + Zustand.
- **Data model**: account configuration, encrypted credentials and tokens, sync state,
  and message metadata (subject, sender, recipients, date, flags, folder, size, etc.)
  are stored in a local SQLite database. Bodies and attachments are never persisted —
  they're fetched live from the mail server when requested.
- Runs as a single Docker container: the API and the background sync scheduler share
  one Python process (no separate worker process needed).

## Requirements

- Docker and Docker Compose.

> **Security note:** inboxone is a single-user application intended for private or
> local-network use. Do not expose it directly to the public internet. For remote
> access, use a trusted VPN or a reverse proxy with independent authentication.

## Quick start

1. Copy the example environment file and fill in real values:
   ```bash
   cp .env.example .env
   ```
2. Generate the required secrets:
   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(32))"   # SECRET_KEY
   python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"   # ENCRYPTION_KEY
   ```
   (If you don't have Python locally, run these one-liners inside the built container
   instead: `docker compose run --rm inboxone python3 -c "..."`.)
3. Set `APP_PASSWORD` in `.env` to a password of your choosing (this only seeds the
   *initial* password - see "Forgot your password?" below for how to reset it later).
4. Pull and start (uses the published image from ghcr.io):
   ```bash
   docker compose up -d
   ```
5. Open `http://localhost:8000`, log in with `APP_PASSWORD`, and add your accounts
   under Settings.

## Install as a Windows app

1. Open inboxone in Microsoft Edge or Google Chrome using **HTTPS** (or
   `http://localhost:8000` on the same PC that runs inboxone). Plain HTTP on a LAN
   IP address or hostname does not support PWA installation.
2. Log in and click **Install InboxOne** above Settings when your browser offers
   installation, or use the browser's install icon in the address bar. The sidebar
   button only appears when the browser makes installation available. In Edge,
   you can also use **More tools → Apps → Install this site as an app**.
3. Launch the installed app, then right-click its Windows taskbar icon and choose
   **Pin to taskbar**.

The installed app uses the same server and loads the current website when opened;
updates do not require reinstalling. It requires a network connection and does not
cache mail for offline use.

To enable new-mail notifications, click the **bell button** in inboxone and allow
notifications in the browser's permission prompt. Windows notifications must also
be enabled for the browser/app. Keep inboxone open (minimized is fine) to receive
notifications; closing all its windows and tabs stops the current notification
watcher. Installation does not add background push notifications. Delivery timing
depends on IMAP IDLE availability and browser background activity limits. Hidden tabs
keep their live event connection, but browser suspension may delay notifications.
Backend inbox watching continues even when all browser windows are closed.

The PNG app icons are generated from the envelope artwork in
`frontend/public/favicon.svg`. After changing its geometry, regenerate them with
`python3 frontend/scripts/generate-icons.py` (no additional dependencies).

## Adding accounts

### Generic IMAP/SMTP (most providers)

Use your provider's IMAP/SMTP host, port, and your normal username/password (or an
app-specific password, see below). Settings → Add account → "Generic IMAP/SMTP".

### Gmail

Gmail requires an **App Password** rather than your normal account password once
2-Step Verification is enabled (Google no longer allows plain account passwords for
IMAP/SMTP). Create one at
[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) and use
it as the IMAP/SMTP password. Host: `imap.gmail.com` (port 993), `smtp.gmail.com`
(port 587).

### Outlook.com

Outlook.com accounts use OAuth2 via a device-code sign-in flow. Go to Settings → Add
account, choose Outlook, enter a name, and select Connect. Enter the displayed code at
[`microsoft.com/devicelogin`](https://microsoft.com/devicelogin), then sign in with
your Microsoft account. inboxone uses built-in OAuth client configuration, so you do
not need to register an Azure application.

## Environment variables

| Variable | Description |
|---|---|
| `APP_PASSWORD` | Password required to access the web UI. |
| `SECRET_KEY` | Random secret used to sign the session cookie. |
| `ENCRYPTION_KEY` | Fernet key used to encrypt stored IMAP/SMTP passwords and OAuth tokens at rest. Do not rotate after accounts exist without a migration - existing encrypted values would become unreadable. |
| `DATABASE_URL` | SQLite connection string (defaults to the `/data` bind mount). |
| `SYNC_DEFAULT_INTERVAL_SECONDS` | Legacy compatibility setting; the global refresh setting below supersedes it. |

## Forgot your password?

`APP_PASSWORD` in `.env` only sets the *initial* password the first time the container
starts - after that, the password lives in the database and editing `.env` no longer
has any effect. If you forget it, reset it directly from inside the running container:

```bash
docker exec -it inboxone python -m app.cli reset-password
```

This prompts for a new password and updates it immediately, without needing to know the
old one - no need to touch `.env` or restart anything.

## Data & privacy model

- inboxone does not upload your mail to a hosted third-party service. Its database and
  application data remain on the server where you run the container.
- The local SQLite database stores the app password hash, account configuration,
  encrypted credentials and OAuth tokens, sync state, and message metadata (subject,
  sender/recipients, date, flags, folder, and size).
- Message bodies and attachments are fetched from the provider when you open or
  download them and are not persisted to disk by inboxone.
- IMAP/SMTP passwords and Microsoft OAuth tokens are encrypted at rest with
  `ENCRYPTION_KEY` and decrypted in memory when needed for a connection.
- Deleting a message moves it to the account's Trash or Deleted Items folder on the
  provider; inboxone does not permanently erase it.
- Sent replies and forwards are saved in the sending account's Sent folder at the
  provider. SMTP accounts use IMAP to save the copy; Gmail and Microsoft accounts
  use their provider's automatic Sent storage. If a message is sent but saving its
  copy fails, inboxone displays a warning so you do not accidentally send it again.

## Folders and synchronization

All selectable folders are discovered on startup and scheduled account refreshes,
including newly created folders.
In **Settings → Accounts → Inbox folders**, check the folders to include in inbox views.
These choices do not change provider folders or stop other folders from syncing.
Expand an account in the sidebar to browse any folder; selecting the account itself
shows only its marked inbox folders. Search and “Mark all as read” apply within the
selected inbox or folder view.

Each inbox-marked folder of an active account has its own persistent IMAP IDLE
connection. Changes trigger reconciliation and committed updates reach open pages
through an authenticated server-sent event stream. IDLE renews every 10 minutes;
connections retry with jittered exponential backoff from 5 seconds to 5 minutes,
using fresh OAuth credentials and catching up after reconnecting. Unsupported IDLE
or provider connection limits visibly fall back to scheduled inbox polling.

Automatic refreshes default to every 15 minutes for all accounts, including inbox
safety checks, polling fallback, other folders, and folder discovery. Change
**Automatic refresh** in Settings to any whole-minute interval from 1 to 1,440 minutes.
The setting persists across restarts and applies immediately without reconnecting
accounts. The schedule is the same for visible and hidden pages. Live mail events
still sync immediately; renewing an idle connection alone does not trigger a sync.
Visibility leases renew every 20 seconds and expire after 60 seconds, so multiple
tabs and unexpectedly closed browsers are handled together. Opening or reloading
a visible page requests a full refresh. Returning to the browser tab does not start
a sync or reload cached messages. Use **Refresh all** in the bottom status bar to
manually sync every active account. Every folder click requests
that folder's refresh while showing cached mail
immediately. Requests across tabs merge with running work, with at most one merged
follow-up pass per account. Account work remains serialized and globally bounded.
The legacy per-account `sync_interval_seconds` API/database field and interval
environment settings remain accepted for compatibility; they no longer control
refresh timing.

The connection button in the bottom status bar (also accessible in Settings)
opens connection details, last successful syncs, sanitized errors, retry
times, per-account Retry, and Refresh all. Green means all active inbox connections
and reconciliations are healthy. Yellow means connecting, retrying, polling fallback,
or a disconnected browser event stream; browser cache polling then runs every 60
seconds. Red means an authentication/configuration failure or reconciliation failure
awaiting successful recovery. The worst active state determines the overall color;
disabled accounts are excluded, and no active accounts produces a neutral status.

The bottom status bar remains visible while browsing folders or reading messages,
including on mobile. A separate spinner and action label show queued or running
work immediately: opening or refreshing messages, syncing folders, sending,
downloading attachments, deleting, and updating read status. Cached content stays
visible during refreshes. Actions in the current tab take priority over background
sync; “+N more” indicates additional work, listed in the connection dialog.
Connection health keeps its own color while work runs. Waiting in IMAP IDLE,
presence renewals, and event heartbeats do not make the app appear busy.
Activity travels over the same event stream; if it disconnects, visible pages check
activity every two seconds until reconnection. Mail cache fallback remains every
60 seconds. Failed and cancelled operations clear their busy state; errors retain
their existing alerts and retry controls.

Persistent watchers use one server connection and one dedicated waiting thread per
marked inbox, plus transient connections for normal mail operations. Account edits,
OAuth reconnects, inbox choices, deactivation, and deletion update watchers automatically.
Keep a single backend process: presence, event subscriptions, and connection state are
held in memory. Reverse proxies must allow long-lived `/api/sync/events` responses;
this endpoint disables buffering and caching and sends a heartbeat every 15 seconds.

The first sync imports all message headers in batches of 200 and resumes after an
interruption. Larger accounts may take time to finish. Bodies and attachments require
an online connection and are fetched only when opened or downloaded. Historical
imports do not generate new-mail notifications. Mail flags and removals are reconciled
on subsequent syncs; folders removed on the provider are removed from the local cache
after successful discovery.

Existing installations migrate automatically on container startup. Existing message
IDs are retained while older history is backfilled. Only standard `INBOX` folders
start marked for inbox inclusion; explicitly mark any additional folders after the
upgrade. Previously disabled folders now synchronize automatically. Copies in multiple
marked folders appear as separate messages.

## Building from source

The published image (`ghcr.io/dermute/inboxone:latest`) is what `docker-compose.yml`
uses by default. To build and run from your own checkout instead, uncomment the
`build:` block in `docker-compose.yml` (and comment out `image:`), then:

```bash
docker compose up -d --build
```

## Development (without Docker)

```bash
# backend (from the repository root)
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e "./backend[dev]"
cd backend
alembic upgrade head
uvicorn app.main:app --reload

# frontend (separate terminal)
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` requests to `http://localhost:8000`.

## Verification

Run `pytest -q` from `backend` after installing the development dependencies, and
`npm run build` from `frontend`. The live-sync backend tests use fake IMAP sockets
and an isolated SQLite database, including reconnects, IDLE fallback, UIDVALIDITY,
visibility leases, event ordering, request merging, and account lifecycle changes.

The optional browser smoke test uses the production build and a local fake API; it
never contacts real mail accounts. With `playwright-core` and Chromium available, run
`node scripts/verify-live-sync.cjs` from `frontend` after building. Set `CHROMIUM_PATH`
if using a system Chromium, and `PLAYWRIGHT_MODULE` if the package is installed
outside the frontend. This checks live messages/counts, notification history suppression,
reconnection, activity lifetimes and foreground priority, status colors, retry controls,
Settings, and the mobile status bar and dialog.

## Known limitations / roadmap

- Browser notifications require an open browser/app instance. Closed-app push
  notifications are not supported; suspended browsers may delay delivery.
- No Gmail OAuth - Gmail accounts are configured as generic IMAP/SMTP using an App
  Password.
- Single user, single SQLite database - not designed for multiple concurrent users.
- Message list "snippet" preview is not populated yet, since generating it would
  require fetching bodies during sync (which this app intentionally avoids to keep
  mail off local storage).

## AI attribution

This project was developed with AI assistance.

<div style="display: flex; align-items: center; white-space: nowrap; gap: 0.5rem; padding: 8px;">
  <div style="font-family: IBM Plex Sans; font-weight: 400; font-size: 16px; line-height: 22px; letter-spacing: 0px;">
    <a rel="noopener noreferrer" href="https://aiattribution.github.io/?model=Fable%205%2C%20Opus%204.8%2C%20GPT%205.6%20Sol" data-cy="recommended-attribution-statement-text" target="_blank" style="font-family: IBM Plex Sans; font-weight: 400; font-size: 16px; line-height: 22px; letter-spacing: 0px;">AIA EAI Hin Nr Fable 5, Opus 4.8, GPT 5.6 Sol</a>
  </div>
  <div style="display: flex; gap: 0.5rem;">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g clip-path="url(#clip0_50_2)">
        <path d="M12 23.5C18.3513 23.5 23.5 18.3513 23.5 12C23.5 5.64873 18.3513 0.5 12 0.5C5.64873 0.5 0.5 5.64873 0.5 12C0.5 18.3513 5.64873 23.5 12 23.5Z" fill="#4E4E4E" stroke="#161616">
        </path>
        <path d="M13.6471 15.6L13.1471 13.94H10.8171L10.3171 15.6H8.77715L11.0771 8.61998H12.9571L15.2271 15.6H13.6471ZM11.9971 9.99998H11.9471L11.1771 12.65H12.7771L11.9971 9.99998Z" fill="white">
        </path>
      </g>
      <defs>
        <clipPath id="clip0_50_2">
          <rect width="24" height="24" fill="white">
          </rect>
        </clipPath>
      </defs>
    </svg>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 17H16.5V16H18V8H16.5V7H18C18.2651 7.0003 18.5193 7.10576 18.7068 7.29323C18.8942 7.4807 18.9997 7.73488 19 8V16C18.9996 16.2651 18.8942 16.5193 18.7067 16.7067C18.5193 16.8942 18.2651 16.9996 18 17Z" fill="#161616">
      </path>
      <path d="M15.5 13C16.0523 13 16.5 12.5523 16.5 12C16.5 11.4477 16.0523 11 15.5 11C14.9477 11 14.5 11.4477 14.5 12C14.5 12.5523 14.9477 13 15.5 13Z" fill="#161616">
      </path>
      <path d="M12 13C12.5523 13 13 12.5523 13 12C13 11.4477 12.5523 11 12 11C11.4477 11 11 11.4477 11 12C11 12.5523 11.4477 13 12 13Z" fill="#161616">
      </path>
      <path d="M8.5 13C9.05228 13 9.5 12.5523 9.5 12C9.5 11.4477 9.05228 11 8.5 11C7.94772 11 7.5 11.4477 7.5 12C7.5 12.5523 7.94772 13 8.5 13Z" fill="#161616">
      </path>
      <path d="M7.5 17H6C5.73488 16.9997 5.4807 16.8942 5.29323 16.7068C5.10576 16.5193 5.0003 16.2651 5 16V8C5.00026 7.73486 5.10571 7.48066 5.29319 7.29319C5.48066 7.10571 5.73486 7.00026 6 7H7.5V8H6V16H7.5V17Z" fill="#161616">
      </path>
      <circle cx="12" cy="12" r="11.5" stroke="#161616">
      </circle>
      <circle cx="12" cy="12" r="11.5" stroke="#161616">
      </circle>
    </svg>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="11.5" stroke="#161616">
      </circle>
      <path d="M10 6C10.4945 6 10.9778 6.14662 11.3889 6.42133C11.8 6.69603 12.1205 7.08648 12.3097 7.54329C12.4989 8.00011 12.5484 8.50277 12.452 8.98773C12.3555 9.47268 12.1174 9.91814 11.7678 10.2678C11.4181 10.6174 10.9727 10.8555 10.4877 10.952C10.0028 11.0484 9.50011 10.9989 9.04329 10.8097C8.58648 10.6205 8.19603 10.3 7.92133 9.88893C7.64662 9.4778 7.5 8.99445 7.5 8.5C7.5 7.83696 7.76339 7.20107 8.23223 6.73223C8.70107 6.26339 9.33696 6 10 6ZM10 5C9.30777 5 8.63108 5.20527 8.0555 5.58986C7.47993 5.97444 7.03133 6.52107 6.76642 7.16061C6.50151 7.80015 6.4322 8.50388 6.56725 9.18282C6.7023 9.86175 7.03564 10.4854 7.52513 10.9749C8.01461 11.4644 8.63825 11.7977 9.31718 11.9327C9.99612 12.0678 10.6999 11.9985 11.3394 11.7336C11.9789 11.4687 12.5256 11.0201 12.9101 10.4445C13.2947 9.86892 13.5 9.19223 13.5 8.5C13.5 7.57174 13.1313 6.6815 12.4749 6.02513C11.8185 5.36875 10.9283 5 10 5Z" fill="#161616">
      </path>
      <path d="M15 19H14V16.5C14 15.837 13.7366 15.2011 13.2678 14.7322C12.7989 14.2634 12.163 14 11.5 14H8.5C7.83696 14 7.20107 14.2634 6.73223 14.7322C6.26339 15.2011 6 15.837 6 16.5V19H5V16.5C5 15.5717 5.36875 14.6815 6.02513 14.0251C6.6815 13.3687 7.57174 13 8.5 13H11.5C12.4283 13 13.3185 13.3687 13.9749 14.0251C14.6313 14.6815 15 15.5717 15 16.5V19Z" fill="#161616">
      </path>
      <path d="M19.9592 9.99025L19.3932 9.42432L17.938 10.8796L16.4827 9.42432L15.9167 9.99025L17.372 11.4455L15.9167 12.9008L16.4827 13.4667L17.938 12.0115L19.3932 13.4667L19.9592 12.9008L18.5039 11.4455L19.9592 9.99025Z" fill="#161616">
      </path>
    </svg>
  </div>
</div>

## License

MIT — see [LICENSE](LICENSE).
