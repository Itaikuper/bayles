import { getDatabase } from '../db.js';
let instance = null;
export function getCalendarLinkRepository() {
    if (!instance) {
        instance = new CalendarLinkRepository();
    }
    return instance;
}
export class CalendarLinkRepository {
    findByJid(jid, tenantId = 'default') {
        const db = getDatabase();
        return db
            .prepare('SELECT * FROM calendar_links WHERE jid = ? AND tenant_id = ? ORDER BY is_default DESC')
            .all(jid, tenantId);
    }
    findDefaultByJid(jid, tenantId = 'default') {
        const db = getDatabase();
        return db
            .prepare('SELECT * FROM calendar_links WHERE jid = ? AND tenant_id = ? AND is_default = 1 LIMIT 1')
            .get(jid, tenantId);
    }
    findDailySummaryLinks(tenantId = 'default') {
        const db = getDatabase();
        return db
            .prepare('SELECT * FROM calendar_links WHERE daily_summary = 1 AND tenant_id = ?')
            .all(tenantId);
    }
    findReminderLinks(tenantId = 'default') {
        const db = getDatabase();
        return db
            .prepare('SELECT * FROM calendar_links WHERE reminder_minutes IS NOT NULL AND tenant_id = ?')
            .all(tenantId);
    }
    getAll(tenantId = 'default') {
        const db = getDatabase();
        return db
            .prepare('SELECT * FROM calendar_links WHERE tenant_id = ? ORDER BY jid, is_default DESC')
            .all(tenantId);
    }
    getById(id) {
        const db = getDatabase();
        return db
            .prepare('SELECT * FROM calendar_links WHERE id = ?')
            .get(id);
    }
    create(jid, calendarId, displayName, tenantId = 'default') {
        const db = getDatabase();
        const result = db
            .prepare('INSERT INTO calendar_links (jid, calendar_id, display_name, tenant_id) VALUES (?, ?, ?, ?)')
            .run(jid, calendarId, displayName || null, tenantId);
        return result.lastInsertRowid;
    }
    update(id, fields) {
        const db = getDatabase();
        const setClauses = [];
        const values = [];
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
        if (setClauses.length === 0)
            return false;
        values.push(id);
        const result = db
            .prepare(`UPDATE calendar_links SET ${setClauses.join(', ')} WHERE id = ?`)
            .run(...values);
        return result.changes > 0;
    }
    delete(id) {
        const db = getDatabase();
        const result = db
            .prepare('DELETE FROM calendar_links WHERE id = ?')
            .run(id);
        return result.changes > 0;
    }
}
