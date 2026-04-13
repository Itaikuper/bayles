import { getDatabase } from '../db.js';
import { logger } from '../../utils/logger.js';
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
        const rows = db
            .prepare('SELECT * FROM calendar_links WHERE jid = ? AND tenant_id = ? AND is_default = 1 ORDER BY id DESC')
            .all(jid, tenantId);
        if (rows.length > 1) {
            logger.warn(`[calendar_links] ${rows.length} rows marked is_default=1 for jid=${jid}; returning most recent (id=${rows[0].id}, calendar_id=${rows[0].calendar_id}).`);
        }
        return rows[0];
    }
    /**
     * Atomically set a single default calendar for a JID: zeroes any other
     * defaults for that JID first, then sets the chosen row.
     */
    setDefault(jid, calendarId, tenantId = 'default') {
        const db = getDatabase();
        const txn = db.transaction(() => {
            db.prepare('UPDATE calendar_links SET is_default = 0 WHERE jid = ? AND tenant_id = ?').run(jid, tenantId);
            const res = db
                .prepare('UPDATE calendar_links SET is_default = 1 WHERE jid = ? AND tenant_id = ? AND calendar_id = ?')
                .run(jid, tenantId, calendarId);
            return res.changes > 0;
        });
        return txn();
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
        // If the caller is setting is_default=1, atomically clear any other defaults
        // for the same JID first so we never end up with multiple defaults.
        if (fields.is_default === 1) {
            const target = db.prepare('SELECT jid, tenant_id FROM calendar_links WHERE id = ?').get(id);
            if (target) {
                const txn = db.transaction(() => {
                    db.prepare('UPDATE calendar_links SET is_default = 0 WHERE jid = ? AND tenant_id = ? AND id != ?').run(target.jid, target.tenant_id, id);
                    values.push(id);
                    return db.prepare(`UPDATE calendar_links SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
                });
                const res = txn();
                return res.changes > 0;
            }
        }
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
