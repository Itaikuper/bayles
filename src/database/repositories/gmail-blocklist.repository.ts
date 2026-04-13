import { getDatabase } from '../db.js';

let instance: GmailBlocklistRepository | null = null;
export function getGmailBlocklistRepository(): GmailBlocklistRepository {
  if (!instance) instance = new GmailBlocklistRepository();
  return instance;
}

/**
 * Stores substrings that the owner has chosen to suppress from the personal-inbox pass.
 * Patterns are lowercased; match is a case-insensitive substring check against the raw From header.
 * Examples: "bezeq", "@iec.co.il", "marketing@partner.co.il".
 */
export class GmailBlocklistRepository {
  add(jid: string, pattern: string): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO gmail_sender_blocklist (jid, pattern, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(jid, pattern) DO NOTHING
    `).run(jid, pattern.trim().toLowerCase(), Date.now());
  }

  remove(jid: string, pattern: string): number {
    const db = getDatabase();
    const res = db.prepare('DELETE FROM gmail_sender_blocklist WHERE jid = ? AND pattern = ?').run(jid, pattern.trim().toLowerCase());
    return res.changes;
  }

  list(jid: string): string[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT pattern FROM gmail_sender_blocklist WHERE jid = ? ORDER BY created_at DESC').all(jid) as { pattern: string }[];
    return rows.map(r => r.pattern);
  }

  matches(jid: string, fromHeader: string): boolean {
    if (!fromHeader) return false;
    const haystack = fromHeader.toLowerCase();
    for (const pattern of this.list(jid)) {
      if (haystack.includes(pattern)) return true;
    }
    return false;
  }
}
