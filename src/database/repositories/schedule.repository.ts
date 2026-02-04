import { getDatabase } from '../db.js';

export interface ScheduleRecord {
  id: string;
  jid: string;
  message: string;
  cron_expression: string;
  one_time: number;
  scheduled_at?: string;
  created_at?: string;
  active?: number;
}

export class ScheduleRepository {
  private db = getDatabase();

  create(record: {
    id: string;
    jid: string;
    message: string;
    cronExpression: string;
    oneTime: boolean;
    scheduledAt?: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO scheduled_messages
      (id, jid, message, cron_expression, one_time, scheduled_at)
      VALUES (@id, @jid, @message, @cronExpression, @oneTime, @scheduledAt)
    `);
    stmt.run({
      id: record.id,
      jid: record.jid,
      message: record.message,
      cronExpression: record.cronExpression,
      oneTime: record.oneTime ? 1 : 0,
      scheduledAt: record.scheduledAt || null,
    });
  }

  findAllActive(): ScheduleRecord[] {
    return this.db
      .prepare(
        `
      SELECT id, jid, message, cron_expression, one_time, scheduled_at, created_at
      FROM scheduled_messages
      WHERE active = 1
    `
      )
      .all() as ScheduleRecord[];
  }

  findById(id: string): ScheduleRecord | undefined {
    return this.db
      .prepare('SELECT * FROM scheduled_messages WHERE id = ?')
      .get(id) as ScheduleRecord | undefined;
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM scheduled_messages WHERE id = ?').run(id);
    return result.changes > 0;
  }

  markInactive(id: string): void {
    this.db.prepare('UPDATE scheduled_messages SET active = 0 WHERE id = ?').run(id);
  }

  countActive(): number {
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM scheduled_messages WHERE active = 1')
      .get() as { count: number };
    return result.count;
  }
}
