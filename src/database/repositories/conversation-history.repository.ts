import { getDatabase } from '../db.js';

export interface ConversationMessage {
  id: number;
  jid: string;
  role: 'user' | 'model';
  content: string;
  tenant_id: string;
  created_at: string;
}

export interface ConversationSummary {
  id: number;
  jid: string;
  summary: string;
  message_count: number;
  tenant_id: string;
  period_start: string;
  period_end: string;
  created_at: string;
}

export class ConversationHistoryRepository {
  private db = getDatabase();

  /**
   * Save a user+model exchange pair
   */
  addExchange(jid: string, userContent: string, modelContent: string, tenantId: string = 'default'): void {
    const stmt = this.db.prepare(
      'INSERT INTO conversation_history (jid, role, content, tenant_id) VALUES (?, ?, ?, ?)'
    );
    const txn = this.db.transaction(() => {
      stmt.run(jid, 'user', userContent, tenantId);
      stmt.run(jid, 'model', modelContent, tenantId);
    });
    txn();
  }

  /**
   * Load last N message pairs (2*limit rows) for a JID, returned in chronological order
   */
  getRecent(jid: string, tenantId: string = 'default', limit: number = 20): ConversationMessage[] {
    return this.db
      .prepare(
        `SELECT * FROM (
          SELECT * FROM conversation_history
          WHERE jid = ? AND tenant_id = ?
          ORDER BY id DESC
          LIMIT ?
        ) sub ORDER BY id ASC`
      )
      .all(jid, tenantId, limit * 2) as ConversationMessage[];
  }

  /**
   * Get messages older than N days for a specific JID
   */
  getOlderThan(jid: string, days: number, tenantId: string = 'default'): ConversationMessage[] {
    return this.db
      .prepare(
        `SELECT * FROM conversation_history
         WHERE jid = ? AND tenant_id = ? AND created_at < datetime('now', ?)
         ORDER BY id ASC`
      )
      .all(jid, tenantId, `-${days} days`) as ConversationMessage[];
  }

  /**
   * Delete messages by their IDs
   */
  deleteByIds(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`DELETE FROM conversation_history WHERE id IN (${placeholders})`).run(...ids);
  }

  /**
   * Get all unique JIDs that have conversation history
   */
  getActiveJids(tenantId: string = 'default'): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT jid FROM conversation_history WHERE tenant_id = ?')
      .all(tenantId) as { jid: string }[];
    return rows.map(r => r.jid);
  }

  /**
   * Save a compaction summary
   */
  addSummary(
    jid: string,
    summary: string,
    messageCount: number,
    periodStart: string,
    periodEnd: string,
    tenantId: string = 'default'
  ): void {
    this.db
      .prepare(
        `INSERT INTO conversation_summaries (jid, summary, message_count, tenant_id, period_start, period_end)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(jid, summary, messageCount, tenantId, periodStart, periodEnd);
  }

  /**
   * Get recent summaries for a JID (newest first, capped)
   */
  getSummaries(jid: string, tenantId: string = 'default', limit: number = 5): ConversationSummary[] {
    return this.db
      .prepare(
        `SELECT * FROM conversation_summaries
         WHERE jid = ? AND tenant_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(jid, tenantId, limit) as ConversationSummary[];
  }

  /**
   * Get formatted summaries string for injection into system prompt
   */
  getFormattedSummaries(jid: string, tenantId: string = 'default'): string {
    const summaries = this.getSummaries(jid, tenantId);
    if (summaries.length === 0) return '';

    // Reverse so oldest summary comes first (chronological order)
    const formatted = summaries
      .reverse()
      .map(s => `- ${s.summary}`)
      .join('\n');
    return `\n\n## סיכום שיחות קודמות:\n${formatted}`;
  }
}

let repositoryInstance: ConversationHistoryRepository | null = null;

export function getConversationHistoryRepository(): ConversationHistoryRepository {
  if (!repositoryInstance) {
    repositoryInstance = new ConversationHistoryRepository();
  }
  return repositoryInstance;
}
