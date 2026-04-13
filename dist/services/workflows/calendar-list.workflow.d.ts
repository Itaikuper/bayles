import { proto } from '@whiskeysockets/baileys';
import { GeminiService } from '../gemini.service.js';
import { CalendarService } from '../calendar.service.js';
import { WhatsAppService } from '../whatsapp.service.js';
export interface CalendarListSlots {
    date_phrase?: string;
    calendar_hint?: string;
    query_hint?: string;
}
export interface CalendarListDeps {
    gemini: GeminiService;
    calendar: CalendarService;
    whatsapp: WhatsAppService;
}
/**
 * Deterministic workflow for "what's on my schedule?".
 * - Resolves date phrase via one focused LLM call (no tool loop).
 * - Picks calendar(s) by hint, otherwise lists across all linked calendars
 *   for this JID (matches existing handleCalendarList behavior).
 * - Always replies — never declines.
 */
export declare function runCalendarListWorkflow(jid: string, slots: CalendarListSlots, message: proto.IWebMessageInfo, deps: CalendarListDeps): Promise<boolean>;
