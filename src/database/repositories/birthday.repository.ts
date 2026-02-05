import { getDatabase } from '../db.js';

export interface BirthdayRecord {
  id: number;
  jid: string;
  person_name: string;
  birth_day: number;
  birth_month: number;
  custom_message?: string | null;
  last_sent_year?: number | null;
  created_at?: string;
}

export class BirthdayRepository {
  private db = getDatabase();

  create(input: {
    jid: string;
    person_name: string;
    birth_day: number;
    birth_month: number;
    custom_message?: string;
  }): number {
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
    return result.lastInsertRowid as number;
  }

  findByDate(day: number, month: number): BirthdayRecord[] {
    return this.db
      .prepare('SELECT * FROM birthdays WHERE birth_day = ? AND birth_month = ?')
      .all(day, month) as BirthdayRecord[];
  }

  findByJid(jid: string): BirthdayRecord[] {
    return this.db
      .prepare('SELECT * FROM birthdays WHERE jid = ? ORDER BY birth_month, birth_day')
      .all(jid) as BirthdayRecord[];
  }

  findById(id: number): BirthdayRecord | undefined {
    return this.db
      .prepare('SELECT * FROM birthdays WHERE id = ?')
      .get(id) as BirthdayRecord | undefined;
  }

  getAll(): BirthdayRecord[] {
    return this.db
      .prepare('SELECT * FROM birthdays ORDER BY birth_month, birth_day')
      .all() as BirthdayRecord[];
  }

  markSent(id: number, year: number): void {
    this.db
      .prepare('UPDATE birthdays SET last_sent_year = ? WHERE id = ?')
      .run(year, id);
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM birthdays WHERE id = ?').run(id);
    return result.changes > 0;
  }

  count(): number {
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM birthdays')
      .get() as { count: number };
    return result.count;
  }
}
