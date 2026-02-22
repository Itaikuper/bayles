import { getDatabase } from '../db.js';
export class ConversationHistoryRepository {
    db = getDatabase();
    /**
     * Save a user+model exchange pair
     */
    addExchange(jid, userContent, modelContent, tenantId = 'default') {
        const stmt = this.db.prepare('INSERT INTO conversation_history (jid, role, content, tenant_id) VALUES (?, ?, ?, ?)');
        const txn = this.db.transaction(() => {
            stmt.run(jid, 'user', userContent, tenantId);
            stmt.run(jid, 'model', modelContent, tenantId);
        });
        txn();
    }
    /**
     * Load last N message pairs (2*limit rows) for a JID, returned in chronological order
     */
    getRecent(jid, tenantId = 'default', limit = 20) {
        return this.db
            .prepare(`SELECT * FROM (
          SELECT * FROM conversation_history
          WHERE jid = ? AND tenant_id = ?
          ORDER BY id DESC
          LIMIT ?
        ) sub ORDER BY id ASC`)
            .all(jid, tenantId, limit * 2);
    }
    /**
     * Get messages older than N days for a specific JID
     */
    getOlderThan(jid, days, tenantId = 'default') {
        return this.db
            .prepare(`SELECT * FROM conversation_history
         WHERE jid = ? AND tenant_id = ? AND created_at < datetime('now', ?)
         ORDER BY id ASC`)
            .all(jid, tenantId, `-${days} days`);
    }
    /**
     * Delete messages by their IDs
     */
    deleteByIds(ids) {
        if (ids.length === 0)
            return;
        const placeholders = ids.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM conversation_history WHERE id IN (${placeholders})`).run(...ids);
    }
    /**
     * Get all unique JIDs that have conversation history
     */
    getActiveJids(tenantId = 'default') {
        const rows = this.db
            .prepare('SELECT DISTINCT jid FROM conversation_history WHERE tenant_id = ?')
            .all(tenantId);
        return rows.map(r => r.jid);
    }
    /**
     * Save a compaction summary
     */
    addSummary(jid, summary, messageCount, periodStart, periodEnd, tenantId = 'default') {
        this.db
            .prepare(`INSERT INTO conversation_summaries (jid, summary, message_count, tenant_id, period_start, period_end)
         VALUES (?, ?, ?, ?, ?, ?)`)
            .run(jid, summary, messageCount, tenantId, periodStart, periodEnd);
    }
    /**
     * Get recent summaries for a JID (newest first, capped)
     */
    getSummaries(jid, tenantId = 'default', limit = 5) {
        return this.db
            .prepare(`SELECT * FROM conversation_summaries
         WHERE jid = ? AND tenant_id = ?
         ORDER BY created_at DESC
         LIMIT ?`)
            .all(jid, tenantId, limit);
    }
    /**
     * Get formatted summaries string for injection into system prompt
     */
    getFormattedSummaries(jid, tenantId = 'default') {
        const summaries = this.getSummaries(jid, tenantId);
        if (summaries.length === 0)
            return '';
        // Reverse so oldest summary comes first (chronological order)
        const formatted = summaries
            .reverse()
            .map(s => `- ${s.summary}`)
            .join('\n');
        return `\n\n## סיכום שיחות קודמות:\n${formatted}`;
    }
}
let repositoryInstance = null;
export function getConversationHistoryRepository() {
    if (!repositoryInstance) {
        repositoryInstance = new ConversationHistoryRepository();
    }
    return repositoryInstance;
}
