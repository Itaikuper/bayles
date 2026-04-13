import { getDatabase } from '../db.js';

export interface TaskRecord {
  id: number;
  jid: string;
  title: string;
  notes: string | null;
  status: 'pending' | 'done' | 'snoozed';
  due_at: number | null;
  snooze_until: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

let instance: TaskRepository | null = null;
export function getTaskRepository(): TaskRepository {
  if (!instance) instance = new TaskRepository();
  return instance;
}

export class TaskRepository {
  add(jid: string, title: string, opts: { notes?: string; dueAt?: number } = {}): TaskRecord {
    const db = getDatabase();
    const now = Date.now();
    const res = db.prepare(`
      INSERT INTO tasks (jid, title, notes, due_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(jid, title, opts.notes || null, opts.dueAt || null, now, now);
    return this.getById(Number(res.lastInsertRowid))!;
  }

  getById(id: number): TaskRecord | undefined {
    const db = getDatabase();
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRecord | undefined;
  }

  list(jid: string, status?: 'pending' | 'done' | 'snoozed' | 'active'): TaskRecord[] {
    const db = getDatabase();
    if (status === 'active') {
      // active = pending OR (snoozed AND snooze_until <= now)
      return db.prepare(`
        SELECT * FROM tasks
        WHERE jid = ?
          AND (status = 'pending' OR (status = 'snoozed' AND snooze_until <= ?))
        ORDER BY COALESCE(due_at, created_at) ASC
      `).all(jid, Date.now()) as TaskRecord[];
    }
    if (status) {
      return db.prepare('SELECT * FROM tasks WHERE jid = ? AND status = ? ORDER BY created_at DESC').all(jid, status) as TaskRecord[];
    }
    return db.prepare('SELECT * FROM tasks WHERE jid = ? ORDER BY created_at DESC').all(jid) as TaskRecord[];
  }

  /** Find by partial title (case-insensitive). Used by complete/snooze when the model doesn't have an id. */
  findByTitle(jid: string, query: string): TaskRecord[] {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM tasks
      WHERE jid = ? AND status != 'done' AND LOWER(title) LIKE LOWER(?)
      ORDER BY created_at DESC LIMIT 5
    `).all(jid, `%${query}%`) as TaskRecord[];
  }

  complete(id: number): boolean {
    const db = getDatabase();
    const now = Date.now();
    const res = db.prepare(`UPDATE tasks SET status='done', completed_at=?, updated_at=? WHERE id=? AND status != 'done'`).run(now, now, id);
    return res.changes > 0;
  }

  snooze(id: number, untilMs: number): boolean {
    const db = getDatabase();
    const now = Date.now();
    const res = db.prepare(`UPDATE tasks SET status='snoozed', snooze_until=?, updated_at=? WHERE id=?`).run(untilMs, now, id);
    return res.changes > 0;
  }
}
