import { getDatabase } from '../db.js';
let instance = null;
export function getGmailRepository() {
    if (!instance)
        instance = new GmailRepository();
    return instance;
}
export class GmailRepository {
    saveCredentials(rec) {
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
    getCredentials(jid) {
        const db = getDatabase();
        return db.prepare('SELECT * FROM gmail_credentials WHERE jid = ?').get(jid);
    }
    deleteCredentials(jid) {
        const db = getDatabase();
        db.prepare('DELETE FROM gmail_credentials WHERE jid = ?').run(jid);
    }
    addWatchLabel(jid, labelId, labelName) {
        const db = getDatabase();
        db.prepare(`
      INSERT INTO gmail_watch_labels (jid, label_id, label_name)
      VALUES (?, ?, ?)
      ON CONFLICT(jid, label_id) DO UPDATE SET label_name = excluded.label_name
    `).run(jid, labelId, labelName);
    }
    removeWatchLabelByName(jid, labelName) {
        const db = getDatabase();
        const res = db.prepare('DELETE FROM gmail_watch_labels WHERE jid = ? AND label_name = ?').run(jid, labelName);
        return res.changes;
    }
    listWatchLabels(jid) {
        const db = getDatabase();
        return db.prepare('SELECT * FROM gmail_watch_labels WHERE jid = ?').all(jid);
    }
    isSeen(jid, messageId) {
        const db = getDatabase();
        const row = db.prepare('SELECT 1 AS ok FROM gmail_seen_messages WHERE jid = ? AND message_id = ?').get(jid, messageId);
        return Boolean(row);
    }
    markSeen(jid, messageId) {
        const db = getDatabase();
        db.prepare(`
      INSERT INTO gmail_seen_messages (jid, message_id, notified_at)
      VALUES (?, ?, ?)
      ON CONFLICT(jid, message_id) DO NOTHING
    `).run(jid, messageId, Date.now());
    }
    pruneSeen(olderThanMs) {
        const db = getDatabase();
        const cutoff = Date.now() - olderThanMs;
        const res = db.prepare('DELETE FROM gmail_seen_messages WHERE notified_at < ?').run(cutoff);
        return res.changes;
    }
}
