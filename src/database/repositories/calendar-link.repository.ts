import { getDatabase } from '../db.js';
import { logger } from '../../utils/logger.js';

export interface CalendarLinkRecord {
  id: number;
  jid: string;
  calendar_id: string;
  display_name: string | null;
  is_default: number;
  daily_summary: number;
  reminder_minutes: number | null;
  tenant_id: string;
  created_at: string;
}

let instance: CalendarLinkRepository | null = null;

export function getCalendarLinkRepository(): CalendarLinkRepository {
  if (!instance) {
    instance = new CalendarLinkRepository();
  }
  return instance;
}

export class CalendarLinkRepository {
  findByJid(jid: string, tenantId: string = 'default'): CalendarLinkRecord[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM calendar_links WHERE jid = ? AND tenant_id = ? ORDER BY is_default DESC')
      .all(jid, tenantId) as CalendarLinkRecord[];
  }

  findDefaultByJid(jid: string, tenantId: string = 'default'): CalendarLinkRecord | undefined {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM calendar_links WHERE jid = ? AND tenant_id = ? AND is_default = 1 ORDER BY id DESC')
      .all(jid, tenantId) as CalendarLinkRecord[];
    if (rows.length > 1) {
      logger.warn(`[calendar_links] ${rows.length} rows marked is_default=1 for jid=${jid}; returning most recent (id=${rows[0].id}, calendar_id=${rows[0].calendar_id}).`);
    }
    return rows[0];
  }

  /**
   * Atomically set a single default calendar for a JID: zeroes any other
   * defaults for that JID first, then sets the chosen row.
   */
  setDefault(jid: string, calendarId: string, tenantId: string = 'default'): boolean {
    const db = getDatabase();
    const txn = db.transaction(() => {
      db.prepare('UPDATE calendar_links SET is_default = 0 WHERE jid = ? AND tenant_id = ?').run(jid, tenantId);
      const res = db
        .prepare('UPDATE calendar_links SET is_default = 1 WHERE jid = ? AND tenant_id = ? AND calendar_id = ?')
        .run(jid, tenantId, calendarId);
      return res.changes > 0;
    });
    return txn() as boolean;
  }

  findDailySummaryLinks(tenantId: string = 'default'): CalendarLinkRecord[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM calendar_links WHERE daily_summary = 1 AND tenant_id = ?')
      .all(tenantId) as CalendarLinkRecord[];
  }

  findReminderLinks(tenantId: string = 'default'): CalendarLinkRecord[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM calendar_links WHERE reminder_minutes IS NOT NULL AND tenant_id = ?')
      .all(tenantId) as CalendarLinkRecord[];
  }

  getAll(tenantId: string = 'default'): CalendarLinkRecord[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM calendar_links WHERE tenant_id = ? ORDER BY jid, is_default DESC')
      .all(tenantId) as CalendarLinkRecord[];
  }

  getById(id: number): CalendarLinkRecord | undefined {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM calendar_links WHERE id = ?')
      .get(id) as CalendarLinkRecord | undefined;
  }

  create(jid: string, calendarId: string, displayName?: string, tenantId: string = 'default'): number {
    const db = getDatabase();
    const result = db
      .prepare('INSERT INTO calendar_links (jid, calendar_id, display_name, tenant_id) VALUES (?, ?, ?, ?)')
      .run(jid, calendarId, displayName || null, tenantId);
    return result.lastInsertRowid as number;
  }

  update(id: number, fields: Partial<Pick<CalendarLinkRecord, 'display_name' | 'is_default' | 'daily_summary' | 'reminder_minutes'>>): boolean {
    const db = getDatabase();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (fields.display_name !== undefined) {
      setClauses.push('display_name = ?');
      values.push(fields.display_name);
    }
    if (fields.is_default !== undefined) {
      setClauses.push('is_default = ?');
      values.push(fields.is_default);
    }
    if (fields.daily_summary !== undefined) {
      setClauses.push('daily_summary = ?');
      values.push(fields.daily_summary);
    }
    if (fields.reminder_minutes !== undefined) {
      setClauses.push('reminder_minutes = ?');
      values.push(fields.reminder_minutes);
    }

    if (setClauses.length === 0) return false;

    // If the caller is setting is_default=1, atomically clear any other defaults
    // for the same JID first so we never end up with multiple defaults.
    if (fields.is_default === 1) {
      const target = db.prepare('SELECT jid, tenant_id FROM calendar_links WHERE id = ?').get(id) as { jid: string; tenant_id: string } | undefined;
      if (target) {
        const txn = db.transaction(() => {
          db.prepare('UPDATE calendar_links SET is_default = 0 WHERE jid = ? AND tenant_id = ? AND id != ?').run(target.jid, target.tenant_id, id);
          values.push(id);
          return db.prepare(`UPDATE calendar_links SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
        });
        const res = txn() as { changes: number };
        return res.changes > 0;
      }
    }

    values.push(id);
    const result = db
      .prepare(`UPDATE calendar_links SET ${setClauses.join(', ')} WHERE id = ?`)
      .run(...values);
    return result.changes > 0;
  }

  delete(id: number): boolean {
    const db = getDatabase();
    const result = db
      .prepare('DELETE FROM calendar_links WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }
}
