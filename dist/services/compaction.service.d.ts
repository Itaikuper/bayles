import { GeminiService } from './gemini.service.js';
export declare class CompactionService {
    private task;
    private gemini;
    constructor(gemini: GeminiService);
    /**
     * Start the compaction cron job - runs every 2 days at 3:00 AM
     */
    start(): void;
    /**
     * Stop the compaction cron job
     */
    stop(): void;
    /**
     * Run compaction for all active JIDs
     */
    runCompaction(): Promise<void>;
    private compactJid;
}
