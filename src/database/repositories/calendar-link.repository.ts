import { getDatabase } from '../db.js';

export interface CalendarLinkRecord {
  id: number;
  jid: string;
  calendar_id: string;
  display_name: string | null;
  is_default: number;
  daily_summary: number;
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
    return db
      .prepare('SELECT * FROM calendar_links WHERE jid = ? AND tenant_id = ? AND is_default = 1 LIMIT 1')
      .get(jid, tenantId) as CalendarLinkRecord | undefined;
  }

  findDailySummaryLinks(tenantId: string = 'default'): CalendarLinkRecord[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM calendar_links WHERE daily_summary = 1 AND tenant_id = ?')
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

  update(id: number, fields: Partial<Pick<CalendarLinkRecord, 'display_name' | 'is_default' | 'daily_summary'>>): boolean {
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

    if (setClauses.length === 0) return false;

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
