import { WhatsAppService } from './whatsapp.service.js';
import { GeminiService } from './gemini.service.js';
import { ChoreRotationRepository, type ChoreRotationRecord } from '../database/repositories/chore-rotation.repository.js';
export declare class ChoreRotationService {
    private cronTask;
    private repo;
    private whatsapp;
    private gemini;
    constructor(whatsapp: WhatsAppService, gemini: GeminiService);
    /**
     * Start the reminder cron - checks every 5 minutes between 07:00-22:00
     */
    start(): void;
    stop(): void;
    /**
     * Check all active rotations and send reminders where due
     */
    checkAndSendReminders(): Promise<void>;
    /**
     * Get current assignee for a rotation without advancing
     */
    getCurrentAssignee(rotation: ChoreRotationRecord): string;
    /**
     * Get formatted summary of all rotations for a JID
     */
    getRotationsSummary(jid: string): string;
    getRepository(): ChoreRotationRepository;
}
