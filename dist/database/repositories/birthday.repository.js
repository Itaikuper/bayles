import { getDatabase } from '../db.js';
export class BirthdayRepository {
    db = getDatabase();
    create(input) {
        const stmt = this.db.prepare(`
      INSERT INTO birthdays (jid, person_name, birth_day, birth_month, custom_message)
      VALUES (@jid, @person_name, @birth_day, @birth_month, @custom_message)
    `);
        const result = stmt.run({
            jid: input.jid,
            person_name: input.person_name,
            birth_day: input.birth_day,
            birth_month: input.birth_month,
            custom_message: input.custom_message || null,
        });
        return result.lastInsertRowid;
    }
    findByDate(day, month) {
        return this.db
            .prepare('SELECT * FROM birthdays WHERE birth_day = ? AND birth_month = ?')
            .all(day, month);
    }
    findByJid(jid) {
        return this.db
            .prepare('SELECT * FROM birthdays WHERE jid = ? ORDER BY birth_month, birth_day')
            .all(jid);
    }
    findById(id) {
        return this.db
            .prepare('SELECT * FROM birthdays WHERE id = ?')
            .get(id);
    }
    getAll() {
        return this.db
            .prepare('SELECT * FROM birthdays ORDER BY birth_month, birth_day')
            .all();
    }
    markSent(id, year) {
        this.db
            .prepare('UPDATE birthdays SET last_sent_year = ? WHERE id = ?')
            .run(year, id);
    }
    delete(id) {
        const result = this.db.prepare('DELETE FROM birthdays WHERE id = ?').run(id);
        return result.changes > 0;
    }
    count() {
        const result = this.db
            .prepare('SELECT COUNT(*) as count FROM birthdays')
            .get();
        return result.count;
    }
}
