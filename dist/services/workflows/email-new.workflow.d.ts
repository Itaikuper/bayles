import { proto } from '@whiskeysockets/baileys';
import { GeminiService } from '../gemini.service.js';
import { GmailService } from '../gmail.service.js';
import { WhatsAppService } from '../whatsapp.service.js';
export interface EmailNewSlots {
    recipient_hint?: string;
    subject_hint?: string;
    topic_hint?: string;
}
export interface EmailNewDeps {
    gemini: GeminiService;
    gmail: GmailService;
    whatsapp: WhatsAppService;
}
/**
 * Deterministic workflow for "draft a new email".
 * Sequence is owned by this function — the LLM is used only for the
 * sub-tasks it's good at (recipient resolution, body generation).
 *
 * Returns true if the workflow handled the request (success or user-visible
 * error), false if the caller should fall back to the agent path.
 */
export declare function runEmailNewWorkflow(jid: string, slots: EmailNewSlots, message: proto.IWebMessageInfo, deps: EmailNewDeps): Promise<boolean>;
