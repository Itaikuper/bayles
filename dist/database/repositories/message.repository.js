import { getDatabase } from '../db.js';
export class MessageRepository {
    db = getDatabase();
    create(record) {
        const stmt = this.db.prepare(`
      INSERT INTO messages (jid, direction, message, sender, is_group)
      VALUES (@jid, @direction, @message, @sender, @is_group)
    `);
        const result = stmt.run({
            jid: record.jid,
            direction: record.direction,
            message: record.message,
            sender: record.sender || null,
            is_group: record.is_group ?? 0,
        });
        return result.lastInsertRowid;
    }
    findByJid(jid, limit = 50, offset = 0) {
        return this.db
            .prepare(`
      SELECT * FROM messages
      WHERE jid = ?
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `)
            .all(jid, limit, offset);
    }
    findAll(limit = 50, offset = 0) {
        return this.db
            .prepare(`
      SELECT * FROM messages
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `)
            .all(limit, offset);
    }
    countToday() {
        const result = this.db
            .prepare(`
      SELECT COUNT(*) as count FROM messages
      WHERE direction = 'outgoing'
      AND date(timestamp) = date('now')
    `)
            .get();
        return result.count;
    }
    count() {
        const result = this.db.prepare('SELECT COUNT(*) as count FROM messages').get();
        return result.count;
    }
}
