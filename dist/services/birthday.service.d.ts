import { WhatsAppService } from './whatsapp.service.js';
import { GeminiService } from './gemini.service.js';
import { type BirthdayRecord } from '../database/repositories/birthday.repository.js';
export declare class BirthdayService {
    private dailyTask;
    private birthdayRepo;
    private whatsapp;
    private gemini;
    constructor(whatsapp: WhatsAppService, gemini: GeminiService);
    /**
     * Start the daily birthday check cron (08:00)
     */
    start(): void;
    /**
     * Stop the daily cron
     */
    stop(): void;
    /**
     * Check today's birthdays and send greetings
     */
    checkAndSendBirthdays(): Promise<void>;
    /**
     * Generate birthday greeting - custom message or AI-generated
     */
    private generateBirthdayMessage;
    /**
     * Parse a natural language birthday list using Gemini AI
     */
    parseBirthdayList(jid: string, text: string): Promise<Array<{
        jid: string;
        person_name: string;
        birth_day: number;
        birth_month: number;
    }>>;
    /**
     * Add parsed birthdays to DB
     */
    addBirthdays(birthdays: Array<{
        jid: string;
        person_name: string;
        birth_day: number;
        birth_month: number;
        custom_message?: string;
    }>): number[];
    getBirthdaysByJid(jid: string): BirthdayRecord[];
    getAllBirthdays(): BirthdayRecord[];
    deleteBirthday(id: number): boolean;
}
