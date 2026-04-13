import { proto } from '@whiskeysockets/baileys';
import { GeminiService } from '../gemini.service.js';
import { CalendarService } from '../calendar.service.js';
import { WhatsAppService } from '../whatsapp.service.js';
export interface CalendarCreateSlots {
    date_phrase?: string;
    time_phrase?: string;
    summary_hint?: string;
    duration_phrase?: string;
    calendar_hint?: string;
}
export interface CalendarCreateDeps {
    gemini: GeminiService;
    calendar: CalendarService;
    whatsapp: WhatsAppService;
}
/**
 * Deterministic workflow for "create a calendar event".
 * - Picks calendar by hint, falls back to default.
 * - Resolves date+time via one focused LLM call.
 * - Calls calendar.events.insert directly. Reply ALWAYS shows which calendar
 *   the event landed on + a clickable htmlLink, so silent mis-routing is impossible.
 */
export declare function runCalendarCreateWorkflow(jid: string, slots: CalendarCreateSlots, message: proto.IWebMessageInfo, deps: CalendarCreateDeps): Promise<boolean>;
