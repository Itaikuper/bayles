import { getDatabase } from '../db.js';

export type ResponseStatus = 'ignored' | 'responded' | 'auto_reply';

export interface ActivityLogEntry {
  id: number;
  jid: string;
  sender: string | null;
  message: string;
  is_group: number;
  response_status: ResponseStatus;
  reason: string | null;
  timestamp: string;
}

export interface CreateActivityLog {
  jid: string;
  sender?: string;
  message: string;
  is_group?: boolean;
  response_status: ResponseStatus;
  reason?: string;
}

export interface ActivityStats {
  total: number;
  responded: number;
  ignored: number;
  auto_reply: number;
  today_total: number;
  today_responded: number;
}

export class ActivityLogRepository {
  private db = getDatabase();

  log(entry: CreateActivityLog): void {
    this.db
      .prepare(
        `INSERT INTO activity_log (jid, sender, message, is_group, response_status, reason)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.jid,
        entry.sender ?? null,
        entry.message,
        entry.is_group ? 1 : 0,
        entry.response_status,
        entry.reason ?? null
      );
  }

  getRecent(limit: number = 100, offset: number = 0): ActivityLogEntry[] {
    return this.db
      .prepare(
        `SELECT * FROM activity_log
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as ActivityLogEntry[];
  }

  getByJid(jid: string, limit: number = 50): ActivityLogEntry[] {
    return this.db
      .prepare(
        `SELECT * FROM activity_log
         WHERE jid = ?
         ORDER BY timestamp DESC
         LIMIT ?`
      )
      .all(jid, limit) as ActivityLogEntry[];
  }

  getByStatus(status: ResponseStatus, limit: number = 100): ActivityLogEntry[] {
    return this.db
      .prepare(
        `SELECT * FROM activity_log
         WHERE response_status = ?
         ORDER BY timestamp DESC
         LIMIT ?`
      )
      .all(status, limit) as ActivityLogEntry[];
  }

  getStats(): ActivityStats {
    const total = this.db
      .prepare('SELECT COUNT(*) as count FROM activity_log')
      .get() as { count: number };

    const responded = this.db
      .prepare("SELECT COUNT(*) as count FROM activity_log WHERE response_status = 'responded'")
      .get() as { count: number };

    const ignored = this.db
      .prepare("SELECT COUNT(*) as count FROM activity_log WHERE response_status = 'ignored'")
      .get() as { count: number };

    const autoReply = this.db
      .prepare("SELECT COUNT(*) as count FROM activity_log WHERE response_status = 'auto_reply'")
      .get() as { count: number };

    const todayTotal = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM activity_log
         WHERE date(timestamp) = date('now')`
      )
      .get() as { count: number };

    const todayResponded = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM activity_log
         WHERE date(timestamp) = date('now')
         AND response_status IN ('responded', 'auto_reply')`
      )
      .get() as { count: number };

    return {
      total: total.count,
      responded: responded.count,
      ignored: ignored.count,
      auto_reply: autoReply.count,
      today_total: todayTotal.count,
      today_responded: todayResponded.count,
    };
  }

  clearOld(daysToKeep: number = 30): number {
    const result = this.db
      .prepare(
        `DELETE FROM activity_log
         WHERE timestamp < datetime('now', '-' || ? || ' days')`
      )
      .run(daysToKeep);
    return result.changes;
  }
}

let repositoryInstance: ActivityLogRepository | null = null;

export function getActivityLogRepository(): ActivityLogRepository {
  if (!repositoryInstance) {
    repositoryInstance = new ActivityLogRepository();
  }
  return repositoryInstance;
}
