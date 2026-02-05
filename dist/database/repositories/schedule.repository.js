import { getDatabase } from '../db.js';
export class ScheduleRepository {
    db = getDatabase();
    create(record) {
        const stmt = this.db.prepare(`
      INSERT INTO scheduled_messages
      (id, jid, message, cron_expression, one_time, scheduled_at, use_ai)
      VALUES (@id, @jid, @message, @cronExpression, @oneTime, @scheduledAt, @useAi)
    `);
        stmt.run({
            id: record.id,
            jid: record.jid,
            message: record.message,
            cronExpression: record.cronExpression,
            oneTime: record.oneTime ? 1 : 0,
            scheduledAt: record.scheduledAt || null,
            useAi: record.useAi ? 1 : 0,
        });
    }
    findAllActive() {
        return this.db
            .prepare(`
      SELECT id, jid, message, cron_expression, one_time, scheduled_at, created_at, use_ai
      FROM scheduled_messages
      WHERE active = 1
    `)
            .all();
    }
    findById(id) {
        return this.db
            .prepare('SELECT * FROM scheduled_messages WHERE id = ?')
            .get(id);
    }
    delete(id) {
        const result = this.db.prepare('DELETE FROM scheduled_messages WHERE id = ?').run(id);
        return result.changes > 0;
    }
    markInactive(id) {
        this.db.prepare('UPDATE scheduled_messages SET active = 0 WHERE id = ?').run(id);
    }
    countActive() {
        const result = this.db
            .prepare('SELECT COUNT(*) as count FROM scheduled_messages WHERE active = 1')
            .get();
        return result.count;
    }
}
