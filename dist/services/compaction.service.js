import cron from 'node-cron';
import { getConversationHistoryRepository } from '../database/repositories/conversation-history.repository.js';
import { logger } from '../utils/logger.js';
const COMPACTION_DAYS = 2;
const MIN_MESSAGES_FOR_COMPACTION = 4; // At least 2 exchanges (4 rows)
export class CompactionService {
    task = null;
    gemini;
    constructor(gemini) {
        this.gemini = gemini;
    }
    /**
     * Start the compaction cron job - runs every 2 days at 3:00 AM
     */
    start() {
        if (this.task) {
            logger.warn('Compaction service already started');
            return;
        }
        // Run at 03:00 every 2 days (on odd days of the month)
        this.task = cron.schedule('0 3 */2 * *', async () => {
            await this.runCompaction();
        });
        logger.info('Compaction service started - runs every 2 days at 03:00');
    }
    /**
     * Stop the compaction cron job
     */
    stop() {
        if (this.task) {
            this.task.stop();
            this.task = null;
            logger.info('Compaction service stopped');
        }
    }
    /**
     * Run compaction for all active JIDs
     */
    async runCompaction() {
        const convRepo = getConversationHistoryRepository();
        const jids = convRepo.getActiveJids();
        logger.info(`[compaction] Starting compaction for ${jids.length} JIDs`);
        for (const jid of jids) {
            try {
                await this.compactJid(jid, convRepo);
            }
            catch (error) {
                logger.error(`[compaction] Failed for ${jid}:`, error);
            }
        }
        logger.info('[compaction] Compaction cycle complete');
    }
    async compactJid(jid, convRepo) {
        const oldMessages = convRepo.getOlderThan(jid, COMPACTION_DAYS);
        if (oldMessages.length < MIN_MESSAGES_FOR_COMPACTION) {
            return;
        }
        logger.info(`[compaction] Compacting ${oldMessages.length} messages for ${jid}`);
        // Build conversation text for summarization
        const conversationText = oldMessages
            .map(m => `${m.role === 'user' ? 'משתמש' : 'בוט'}: ${m.content}`)
            .join('\n');
        const prompt = `סכם את השיחה הבאה בקצרה (2-4 משפטים). התמקד בנושאים העיקריים ובמידע חשוב שנדונו. כתוב בגוף שלישי.

שיחה:
${conversationText}

סיכום:`;
        const summary = await this.gemini.generateScheduledContent(prompt);
        const periodStart = oldMessages[0].created_at;
        const periodEnd = oldMessages[oldMessages.length - 1].created_at;
        convRepo.addSummary(jid, summary, oldMessages.length, periodStart, periodEnd);
        const ids = oldMessages.map(m => m.id);
        convRepo.deleteByIds(ids);
        logger.info(`[compaction] Compacted ${oldMessages.length} messages into summary for ${jid}`);
    }
}
