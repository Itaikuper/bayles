import { getDatabase } from '../db.js';

export interface MessageRecord {
  id?: number;
  jid: string;
  direction: 'incoming' | 'outgoing';
  message: string;
  sender?: string;
  timestamp?: string;
  is_group?: number;
}

export class MessageRepository {
  private db = getDatabase();

  create(record: MessageRecord): number {
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
    return result.lastInsertRowid as number;
  }

  findByJid(jid: string, limit = 50, offset = 0): MessageRecord[] {
    return this.db
      .prepare(
        `
      SELECT * FROM messages
      WHERE jid = ?
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `
      )
      .all(jid, limit, offset) as MessageRecord[];
  }

  findAll(limit = 50, offset = 0): MessageRecord[] {
    return this.db
      .prepare(
        `
      SELECT * FROM messages
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `
      )
      .all(limit, offset) as MessageRecord[];
  }

  countToday(): number {
    const result = this.db
      .prepare(
        `
      SELECT COUNT(*) as count FROM messages
      WHERE direction = 'outgoing'
      AND date(timestamp) = date('now')
    `
      )
      .get() as { count: number };
    return result.count;
  }

  count(): number {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM messages').get() as {
      count: number;
    };
    return result.count;
  }
}
