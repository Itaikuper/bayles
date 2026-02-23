import { calendar_v3 } from 'googleapis';
import type { WhatsAppService } from './whatsapp.service.js';
import type { GeminiService } from './gemini.service.js';
export declare class CalendarService {
    private whatsapp;
    private gemini;
    private calendar;
    private cronTask;
    private reminderCronTask;
    private sentReminders;
    constructor(whatsapp: WhatsAppService, gemini: GeminiService);
    start(): void;
    stop(): void;
    sendDailySummaries(): Promise<void>;
    checkAndSendReminders(): Promise<void>;
    listEvents(calendarId: string, timeMin: Date, timeMax: Date, query?: string): Promise<calendar_v3.Schema$Event[]>;
    createEvent(calendarId: string, summary: string, startTime: Date, endTime: Date): Promise<calendar_v3.Schema$Event>;
    updateEvent(calendarId: string, eventId: string, updates: {
        summary?: string;
        start?: Date;
        end?: Date;
    }): Promise<calendar_v3.Schema$Event>;
    deleteEvent(calendarId: string, eventId: string): Promise<void>;
    listEventsForJid(jid: string, startDate: Date, endDate: Date, query?: string): Promise<calendar_v3.Schema$Event[]>;
    createEventForJid(jid: string, summary: string, startTime: Date, endTime: Date): Promise<calendar_v3.Schema$Event | null>;
    searchEventForJid(jid: string, query: string, searchDate: Date): Promise<{
        event: calendar_v3.Schema$Event;
        calendarId: string;
    } | null>;
    formatEventList(events: calendar_v3.Schema$Event[], label?: string): string;
    private generateMeetingBrief;
    private getMeetingLink;
    private formatEventTime;
}
