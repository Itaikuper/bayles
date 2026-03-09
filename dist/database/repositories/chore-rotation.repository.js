import { getDatabase } from '../db.js';
export class ChoreRotationRepository {
    db = getDatabase();
    create(input) {
        const stmt = this.db.prepare(`
      INSERT INTO chore_rotations (jid, name, members, frequency, reminder_hour, reminder_minute)
      VALUES (@jid, @name, @members, @frequency, @reminder_hour, @reminder_minute)
    `);
        const result = stmt.run({
            jid: input.jid,
            name: input.name,
            members: JSON.stringify(input.members),
            frequency: input.frequency || 'daily',
            reminder_hour: input.reminder_hour ?? 8,
            reminder_minute: input.reminder_minute ?? 0,
        });
        return result.lastInsertRowid;
    }
    findByJid(jid) {
        return this.db
            .prepare('SELECT * FROM chore_rotations WHERE jid = ? AND active = 1 ORDER BY name')
            .all(jid);
    }
    findByJidAndName(jid, name) {
        return this.db
            .prepare('SELECT * FROM chore_rotations WHERE jid = ? AND name = ? AND active = 1')
            .get(jid, name);
    }
    /**
     * Fuzzy search: find rotation where name contains the query (case-insensitive)
     */
    searchByJidAndName(jid, query) {
        const rotations = this.findByJid(jid);
        // Try exact match first
        const exact = rotations.find(r => r.name === query);
        if (exact)
            return exact;
        // Try contains match
        return rotations.find(r => r.name.includes(query) || query.includes(r.name));
    }
    getActiveRotations() {
        return this.db
            .prepare('SELECT * FROM chore_rotations WHERE active = 1')
            .all();
    }
    advance(id, newIndex) {
        this.db
            .prepare('UPDATE chore_rotations SET current_index = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(newIndex, id);
    }
    markSent(id, dateStr) {
        this.db
            .prepare('UPDATE chore_rotations SET last_sent_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(dateStr, id);
    }
    updateMembers(id, members) {
        this.db
            .prepare('UPDATE chore_rotations SET members = ?, current_index = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(JSON.stringify(members), id);
    }
    delete(id) {
        const result = this.db.prepare('DELETE FROM chore_rotations WHERE id = ?').run(id);
        return result.changes > 0;
    }
    deactivate(id) {
        this.db
            .prepare('UPDATE chore_rotations SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(id);
    }
    count() {
        const result = this.db
            .prepare('SELECT COUNT(*) as count FROM chore_rotations WHERE active = 1')
            .get();
        return result.count;
    }
}
let instance = null;
export function getChoreRotationRepository() {
    if (!instance)
        instance = new ChoreRotationRepository();
    return instance;
}
