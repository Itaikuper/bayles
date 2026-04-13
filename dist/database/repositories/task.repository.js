import { getDatabase } from '../db.js';
let instance = null;
export function getTaskRepository() {
    if (!instance)
        instance = new TaskRepository();
    return instance;
}
export class TaskRepository {
    add(jid, title, opts = {}) {
        const db = getDatabase();
        const now = Date.now();
        const res = db.prepare(`
      INSERT INTO tasks (jid, title, notes, due_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(jid, title, opts.notes || null, opts.dueAt || null, now, now);
        return this.getById(Number(res.lastInsertRowid));
    }
    getById(id) {
        const db = getDatabase();
        return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    }
    list(jid, status) {
        const db = getDatabase();
        if (status === 'active') {
            // active = pending OR (snoozed AND snooze_until <= now)
            return db.prepare(`
        SELECT * FROM tasks
        WHERE jid = ?
          AND (status = 'pending' OR (status = 'snoozed' AND snooze_until <= ?))
        ORDER BY COALESCE(due_at, created_at) ASC
      `).all(jid, Date.now());
        }
        if (status) {
            return db.prepare('SELECT * FROM tasks WHERE jid = ? AND status = ? ORDER BY created_at DESC').all(jid, status);
        }
        return db.prepare('SELECT * FROM tasks WHERE jid = ? ORDER BY created_at DESC').all(jid);
    }
    /** Find by partial title (case-insensitive). Used by complete/snooze when the model doesn't have an id. */
    findByTitle(jid, query) {
        const db = getDatabase();
        return db.prepare(`
      SELECT * FROM tasks
      WHERE jid = ? AND status != 'done' AND LOWER(title) LIKE LOWER(?)
      ORDER BY created_at DESC LIMIT 5
    `).all(jid, `%${query}%`);
    }
    complete(id) {
        const db = getDatabase();
        const now = Date.now();
        const res = db.prepare(`UPDATE tasks SET status='done', completed_at=?, updated_at=? WHERE id=? AND status != 'done'`).run(now, now, id);
        return res.changes > 0;
    }
    snooze(id, untilMs) {
        const db = getDatabase();
        const now = Date.now();
        const res = db.prepare(`UPDATE tasks SET status='snoozed', snooze_until=?, updated_at=? WHERE id=?`).run(untilMs, now, id);
        return res.changes > 0;
    }
}
