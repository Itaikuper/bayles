import { WhatsAppService } from './whatsapp.service.js';
import { GeminiService } from './gemini.service.js';
import type { ScheduledMessageInfo } from '../types/index.js';
export declare class SchedulerService {
    private scheduledMessages;
    private whatsapp;
    private gemini;
    constructor(whatsapp: WhatsAppService, gemini: GeminiService);
    /**
     * Create the execution callback for a scheduled message
     */
    private createExecutionCallback;
    /**
     * Schedule a message with a cron expression
     */
    scheduleMessage(jid: string, message: string, cronExpression: string, oneTime?: boolean, useAi?: boolean): string;
    /**
     * Schedule a one-time message at a specific date/time
     */
    scheduleOneTimeMessage(jid: string, message: string, date: Date, useAi?: boolean): string;
    /**
     * Convert a Date to a cron expression
     */
    private dateToCron;
    /**
     * Cancel a scheduled message
     */
    cancelScheduledMessage(id: string): boolean;
    /**
     * List all scheduled messages
     */
    listScheduledMessages(): ScheduledMessageInfo[];
    /**
     * Cancel all scheduled messages
     */
    cancelAll(): void;
    /**
     * Restore scheduled messages from database after restart
     */
    restoreFromDatabase(): void;
    /**
     * Schedule a message with a specific ID (for restoring from database)
     */
    private scheduleMessageWithId;
}
