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
export declare class ConversationHistoryRepository {
    private db;
    /**
     * Save a user+model exchange pair
     */
    addExchange(jid: string, userContent: string, modelContent: string, tenantId?: string): void;
    /**
     * Load last N message pairs (2*limit rows) for a JID, returned in chronological order
     */
    getRecent(jid: string, tenantId?: string, limit?: number): ConversationMessage[];
    /**
     * Get messages older than N days for a specific JID
     */
    getOlderThan(jid: string, days: number, tenantId?: string): ConversationMessage[];
    /**
     * Delete messages by their IDs
     */
    deleteByIds(ids: number[]): void;
    /**
     * Get all unique JIDs that have conversation history
     */
    getActiveJids(tenantId?: string): string[];
    /**
     * Save a compaction summary
     */
    addSummary(jid: string, summary: string, messageCount: number, periodStart: string, periodEnd: string, tenantId?: string): void;
    /**
     * Get recent summaries for a JID (newest first, capped)
     */
    getSummaries(jid: string, tenantId?: string, limit?: number): ConversationSummary[];
    /**
     * Get formatted summaries string for injection into system prompt
     */
    getFormattedSummaries(jid: string, tenantId?: string): string;
}
export declare function getConversationHistoryRepository(): ConversationHistoryRepository;
