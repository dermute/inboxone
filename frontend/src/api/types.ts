export interface Folder {
  id: number;
  imap_path: string;
  display_name: string | null;
  sync_enabled: boolean;
  last_synced_at: string | null;
  unread_count: number;
}

export interface Account {
  id: number;
  name: string;
  color: string;
  protocol: "imap_basic" | "oauth_microsoft";
  is_active: boolean;
  imap_host: string | null;
  imap_port: number | null;
  imap_use_tls: boolean;
  imap_username: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_use_tls: boolean;
  smtp_username: string | null;
  oauth_client_id: string | null;
  oauth_tenant: string | null;
  sync_interval_seconds: number | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  folders: Folder[];
}

export interface AccountCreateBasic {
  name: string;
  color: string;
  imap_host: string;
  imap_port: number;
  imap_use_tls: boolean;
  imap_username: string;
  imap_password: string;
  smtp_host: string;
  smtp_port: number;
  smtp_use_tls: boolean;
  smtp_username: string;
  smtp_password: string;
  sync_interval_seconds?: number | null;
}

export interface TestConnectionResult {
  imap_ok: boolean;
  imap_error: string | null;
  smtp_ok: boolean | null;
  smtp_error: string | null;
}

export interface MessageSummary {
  id: number;
  account_id: number;
  account_color: string;
  account_name: string;
  folder_id: number;
  subject: string | null;
  from_name: string | null;
  from_addr: string | null;
  to_addrs: string[];
  cc_addrs: string[];
  date_sent: string | null;
  is_seen: boolean;
  is_flagged: boolean;
  is_answered: boolean;
  has_attachments: boolean;
  snippet: string | null;
}

export interface MessageListPage {
  items: MessageSummary[];
  next_cursor: string | null;
}

export interface AttachmentMeta {
  part_index: string;
  filename: string | null;
  content_type: string;
  size: number | null;
  content_id: string | null;
}

export interface MessageDetail {
  id: number;
  subject: string | null;
  from_name: string | null;
  from_addr: string | null;
  to_addrs: string[];
  cc_addrs: string[];
  date_sent: string | null;
  text_body: string | null;
  html_body: string | null;
  attachments: AttachmentMeta[];
  message_id_header: string | null;
  references: string | null;
}
