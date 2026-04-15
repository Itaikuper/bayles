import { getDatabase } from '../db.js';

export interface TaskRecord {
  id: number;
  jid: string;
  title: string;
  notes: string | null;
  category: string | null;
  status: 'pending' | 'done' | 'snoozed';
  due_at: number | null;
  snooze_until: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface TaskEditPatch {
  title?: string;
  notes?: string | null;
  category?: string | null;
  dueAt?: number | null;
}

let instance: TaskRepository | null = null;
export function getTaskRepository(): TaskRepository {
  if (!instance) instance = new TaskRepository();
  return instance;
}

export class TaskRepository {
  add(jid: string, title: string, opts: { notes?: string; dueAt?: number; category?: string } = {}): TaskRecord {
    const db = getDatabase();
    const now = Date.now();
    const res = db.prepare(`
      INSERT INTO tasks (jid, title, notes, category, due_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(jid, title, opts.notes || null, opts.category || null, opts.dueAt || null, now, now);
    return this.getById(Number(res.lastInsertRowid))!;
  }

  getById(id: number): TaskRecord | undefined {
    const db = getDatabase();
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRecord | undefined;
  }

  /**
   * List tasks for a JID, optionally filtered by status and/or category.
   * Ordering: due date ascending (earliest first), NULL due dates last, then created_at ascending.
   */
  list(
    jid: string,
    status?: 'pending' | 'done' | 'snoozed' | 'active',
    category?: string,
  ): TaskRecord[] {
    const db = getDatabase();
    const cat = category?.trim().toLowerCase() || undefined;
    // Ordering: urgent items first (due soon), then undated by creation order.
    const order = `ORDER BY
      CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
      due_at ASC,
      created_at ASC`;
    if (status === 'active') {
      const rows = db.prepare(`
        SELECT * FROM tasks
        WHERE jid = ?
          AND (status = 'pending' OR (status = 'snoozed' AND snooze_until <= ?))
          ${cat ? 'AND LOWER(category) = ?' : ''}
        ${order}
      `).all(...(cat ? [jid, Date.now(), cat] : [jid, Date.now()])) as TaskRecord[];
      return rows;
    }
    if (status) {
      return db.prepare(`
        SELECT * FROM tasks WHERE jid = ? AND status = ?
          ${cat ? 'AND LOWER(category) = ?' : ''}
        ${order}
      `).all(...(cat ? [jid, status, cat] : [jid, status])) as TaskRecord[];
    }
    return db.prepare(`
      SELECT * FROM tasks WHERE jid = ?
        ${cat ? 'AND LOWER(category) = ?' : ''}
      ${order}
    `).all(...(cat ? [jid, cat] : [jid])) as TaskRecord[];
  }

  /** Distinct categories with active-task counts — useful for "what categories do I have?". */
  listCategories(jid: string): { category: string; count: number }[] {
    const db = getDatabase();
    return db.prepare(`
      SELECT COALESCE(category, 'general') AS category, COUNT(*) AS count
      FROM tasks
      WHERE jid = ? AND (status = 'pending' OR (status = 'snoozed' AND snooze_until <= ?))
      GROUP BY COALESCE(category, 'general')
      ORDER BY count DESC
    `).all(jid, Date.now()) as { category: string; count: number }[];
  }

  /** Find by partial title (case-insensitive). Used by complete/snooze/edit when the model doesn't have an id. */
  findByTitle(jid: string, query: string): TaskRecord[] {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM tasks
      WHERE jid = ? AND status != 'done' AND LOWER(title) LIKE LOWER(?)
      ORDER BY created_at DESC LIMIT 5
    `).all(jid, `%${query}%`) as TaskRecord[];
  }

  /** Update selected fields. Only provided keys are changed. Returns the updated row. */
  edit(id: number, patch: TaskEditPatch): TaskRecord | undefined {
    const db = getDatabase();
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    if (patch.title !== undefined) { sets.push('title = ?'); values.push(patch.title); }
    if (patch.notes !== undefined) { sets.push('notes = ?'); values.push(patch.notes); }
    if (patch.category !== undefined) { sets.push('category = ?'); values.push(patch.category); }
    if (patch.dueAt !== undefined) { sets.push('due_at = ?'); values.push(patch.dueAt); }
    if (sets.length === 0) return this.getById(id);
    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(id);
  }

  complete(id: number): boolean {
    const db = getDatabase();
    const now = Date.now();
    const res = db.prepare(`UPDATE tasks SET status='done', completed_at=?, updated_at=? WHERE id=? AND status != 'done'`).run(now, now, id);
    return res.changes > 0;
  }

  /**
   * Hard-delete a task by id. Row is physically removed from the tasks table.
   * The id is NOT reused — sqlite_sequence.tasks tracks the max-ever id
   * (INTEGER PRIMARY KEY AUTOINCREMENT semantics). This is distinct from
   * complete() which leaves the row in place with status='done'.
   */
  remove(id: number): boolean {
    const db = getDatabase();
    const res = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return res.changes > 0;
  }

  /**
   * Bulk hard-delete. Filter semantics identical to list(). Returns count deleted.
   * Refuses empty filter as a safety valve so we never accidentally nuke everything.
   *   - status='active' → pending OR (snoozed AND past due_until)
   *   - status=<other> → exact status match
   *   - category → case-insensitive category filter (combinable with status)
   *
   * After delete, compacts `sqlite_sequence.tasks` down to MAX(id) of remaining rows.
   * This prevents ugly ID jumps ("I cleared the list, why is my new task #47?"). IDs
   * still never duplicate live rows, but after a mass cleanup the next add picks up
   * just above the highest surviving id instead of the highest-ever-used id.
   */
  removeBulk(jid: string, filter: { status?: 'pending' | 'done' | 'snoozed' | 'active'; category?: string } = {}): number {
    const db = getDatabase();
    const cat = filter.category?.trim().toLowerCase() || undefined;
    let changes = 0;
    if (filter.status === 'active') {
      const res = db.prepare(`
        DELETE FROM tasks
        WHERE jid = ?
          AND (status = 'pending' OR (status = 'snoozed' AND snooze_until <= ?))
          ${cat ? 'AND LOWER(category) = ?' : ''}
      `).run(...(cat ? [jid, Date.now(), cat] : [jid, Date.now()]));
      changes = res.changes;
    } else if (filter.status) {
      const res = db.prepare(`
        DELETE FROM tasks WHERE jid = ? AND status = ? ${cat ? 'AND LOWER(category) = ?' : ''}
      `).run(...(cat ? [jid, filter.status, cat] : [jid, filter.status]));
      changes = res.changes;
    } else if (cat) {
      const res = db.prepare('DELETE FROM tasks WHERE jid = ? AND LOWER(category) = ?').run(jid, cat);
      changes = res.changes;
    } else {
      throw new Error('removeBulk requires at least status or category filter');
    }

    if (changes > 0) {
      // Compact the auto-increment counter to the highest surviving id
      // (or 0 if the table is now empty). sqlite_sequence is a system table that
      // backs AUTOINCREMENT — writing to it is supported and safe.
      const maxRow = db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM tasks').get() as { m: number };
      db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'tasks'").run(maxRow.m);
    }

    return changes;
  }

  snooze(id: number, untilMs: number): boolean {
    const db = getDatabase();
    const now = Date.now();
    const res = db.prepare(`UPDATE tasks SET status='snoozed', snooze_until=?, updated_at=? WHERE id=?`).run(untilMs, now, id);
    return res.changes > 0;
  }
}
