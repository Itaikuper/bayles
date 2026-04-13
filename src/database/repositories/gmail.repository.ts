import { getDatabase } from '../db.js';

export interface GmailCredentialRecord {
  jid: string;
  refresh_token_enc: string;
  email_address: string;
  scopes: string;
  created_at: number;
  updated_at: number;
}

export interface GmailWatchLabel {
  jid: string;
  label_id: string;
  label_name: string;
}

let instance: GmailRepository | null = null;

export function getGmailRepository(): GmailRepository {
  if (!instance) instance = new GmailRepository();
  return instance;
}

export class GmailRepository {
  saveCredentials(rec: Omit<GmailCredentialRecord, 'created_at' | 'updated_at'>): void {
    const db = getDatabase();
    const now = Date.now();
    db.prepare(`
      INSERT INTO gmail_credentials (jid, refresh_token_enc, email_address, scopes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        refresh_token_enc = excluded.refresh_token_enc,
        email_address = excluded.email_address,
        scopes = excluded.scopes,
        updated_at = excluded.updated_at
    `).run(rec.jid, rec.refresh_token_enc, rec.email_address, rec.scopes, now, now);
  }

  getCredentials(jid: string): GmailCredentialRecord | undefined {
    const db = getDatabase();
    return db.prepare('SELECT * FROM gmail_credentials WHERE jid = ?').get(jid) as GmailCredentialRecord | undefined;
  }

  deleteCredentials(jid: string): void {
    const db = getDatabase();
    db.prepare('DELETE FROM gmail_credentials WHERE jid = ?').run(jid);
  }

  addWatchLabel(jid: string, labelId: string, labelName: string): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO gmail_watch_labels (jid, label_id, label_name)
      VALUES (?, ?, ?)
      ON CONFLICT(jid, label_id) DO UPDATE SET label_name = excluded.label_name
    `).run(jid, labelId, labelName);
  }

  removeWatchLabelByName(jid: string, labelName: string): number {
    const db = getDatabase();
    const res = db.prepare('DELETE FROM gmail_watch_labels WHERE jid = ? AND label_name = ?').run(jid, labelName);
    return res.changes;
  }

  listWatchLabels(jid: string): GmailWatchLabel[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM gmail_watch_labels WHERE jid = ?').all(jid) as GmailWatchLabel[];
  }

  isSeen(jid: string, messageId: string): boolean {
    const db = getDatabase();
    const row = db.prepare('SELECT 1 AS ok FROM gmail_seen_messages WHERE jid = ? AND message_id = ?').get(jid, messageId);
    return Boolean(row);
  }

  markSeen(jid: string, messageId: string): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO gmail_seen_messages (jid, message_id, notified_at)
      VALUES (?, ?, ?)
      ON CONFLICT(jid, message_id) DO NOTHING
    `).run(jid, messageId, Date.now());
  }

  // --- Sender watch list ---

  addWatchSender(jid: string, email: string): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO gmail_watch_senders (jid, email, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(jid, email) DO NOTHING
    `).run(jid, email.toLowerCase(), Date.now());
  }

  removeWatchSender(jid: string, email: string): number {
    const db = getDatabase();
    const res = db.prepare('DELETE FROM gmail_watch_senders WHERE jid = ? AND email = ?').run(jid, email.toLowerCase());
    return res.changes;
  }

  listWatchSenders(jid: string): string[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT email FROM gmail_watch_senders WHERE jid = ?').all(jid) as { email: string }[];
    return rows.map(r => r.email);
  }

  pruneSeen(olderThanMs: number): number {
    const db = getDatabase();
    const cutoff = Date.now() - olderThanMs;
    const res = db.prepare('DELETE FROM gmail_seen_messages WHERE notified_at < ?').run(cutoff);
    return res.changes;
  }
}
