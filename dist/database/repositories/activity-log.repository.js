import { getDatabase } from '../db.js';
export class ActivityLogRepository {
    db = getDatabase();
    log(entry) {
        this.db
            .prepare(`INSERT INTO activity_log (jid, sender, message, is_group, response_status, reason)
         VALUES (?, ?, ?, ?, ?, ?)`)
            .run(entry.jid, entry.sender ?? null, entry.message, entry.is_group ? 1 : 0, entry.response_status, entry.reason ?? null);
    }
    getRecent(limit = 100, offset = 0) {
        return this.db
            .prepare(`SELECT * FROM activity_log
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`)
            .all(limit, offset);
    }
    getByJid(jid, limit = 50) {
        return this.db
            .prepare(`SELECT * FROM activity_log
         WHERE jid = ?
         ORDER BY timestamp DESC
         LIMIT ?`)
            .all(jid, limit);
    }
    getByStatus(status, limit = 100) {
        return this.db
            .prepare(`SELECT * FROM activity_log
         WHERE response_status = ?
         ORDER BY timestamp DESC
         LIMIT ?`)
            .all(status, limit);
    }
    getStats() {
        const total = this.db
            .prepare('SELECT COUNT(*) as count FROM activity_log')
            .get();
        const responded = this.db
            .prepare("SELECT COUNT(*) as count FROM activity_log WHERE response_status = 'responded'")
            .get();
        const ignored = this.db
            .prepare("SELECT COUNT(*) as count FROM activity_log WHERE response_status = 'ignored'")
            .get();
        const autoReply = this.db
            .prepare("SELECT COUNT(*) as count FROM activity_log WHERE response_status = 'auto_reply'")
            .get();
        const todayTotal = this.db
            .prepare(`SELECT COUNT(*) as count FROM activity_log
         WHERE date(timestamp) = date('now')`)
            .get();
        const todayResponded = this.db
            .prepare(`SELECT COUNT(*) as count FROM activity_log
         WHERE date(timestamp) = date('now')
         AND response_status IN ('responded', 'auto_reply')`)
            .get();
        return {
            total: total.count,
            responded: responded.count,
            ignored: ignored.count,
            auto_reply: autoReply.count,
            today_total: todayTotal.count,
            today_responded: todayResponded.count,
        };
    }
    clearOld(daysToKeep = 30) {
        const result = this.db
            .prepare(`DELETE FROM activity_log
         WHERE timestamp < datetime('now', '-' || ? || ' days')`)
            .run(daysToKeep);
        return result.changes;
    }
}
let repositoryInstance = null;
export function getActivityLogRepository() {
    if (!repositoryInstance) {
        repositoryInstance = new ActivityLogRepository();
    }
    return repositoryInstance;
}
