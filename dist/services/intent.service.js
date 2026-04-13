import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
const intentSchema = {
    type: Type.OBJECT,
    properties: {
        intent: {
            type: Type.STRING,
            enum: ['email_new', 'calendar_list', 'calendar_create', 'general'],
            description: 'email_new = compose a brand-new email draft (not a reply). ' +
                'calendar_list = ask about schedule / events / agenda for a date or range ("מה הלוז", "מה יש לי היום", "events tomorrow"). ' +
                'calendar_create = create a calendar event ("תקבע פגישה", "קבע לי", "תוסיף ליומן"). ' +
                'general = anything else (email replies, tasks, memory queries, casual chat, multi-step asks).',
        },
        recipient_hint: { type: Type.STRING, description: 'email_new only: WHO to email. Empty string if not mentioned.' },
        subject_hint: { type: Type.STRING, description: 'email_new only: stated subject. Empty string if not mentioned.' },
        topic_hint: { type: Type.STRING, description: 'email_new only: what the email is about. Empty string if not mentioned.' },
        date_phrase: { type: Type.STRING, description: 'calendar_* only: raw date phrase ("היום", "מחר", "השבוע", "ב-15"). Empty string if not mentioned.' },
        time_phrase: { type: Type.STRING, description: 'calendar_create only: raw time phrase ("ב21:30", "10 בבוקר"). Empty string if not mentioned.' },
        summary_hint: { type: Type.STRING, description: 'calendar_create only: event title/short description. Empty string if not mentioned.' },
        duration_phrase: { type: Type.STRING, description: 'calendar_create only: duration phrase ("שעה", "30 דקות"). Empty string if not mentioned.' },
        calendar_hint: { type: Type.STRING, description: 'calendar_* only: which calendar to use, if specified ("של אסתר", "המשותף"). Empty string if not mentioned.' },
        query_hint: { type: Type.STRING, description: 'calendar_list only: filter text ("פגישות עם דנה"). Empty string if not mentioned.' },
        reasoning: { type: Type.STRING, description: 'One short Hebrew sentence explaining the chosen intent. Debug-only.' },
    },
    required: ['intent', 'recipient_hint', 'subject_hint', 'topic_hint', 'date_phrase', 'time_phrase', 'summary_hint', 'duration_phrase', 'calendar_hint', 'query_hint', 'reasoning'],
};
export class IntentService {
    ai;
    constructor() {
        this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    }
    async classify(userMessage) {
        const prompt = `You are an intent classifier for a Hebrew WhatsApp personal assistant.

Classify the user's message into exactly one of:

- email_new — DRAFT A FRESH NEW EMAIL (not a reply). Verbs: "שלח/כתוב/תכין/תנסח מייל", "send/write/draft/compose email".
- calendar_list — ask about SCHEDULE / EVENTS / AGENDA for a date or range. Examples: "מה הלוז שלי היום", "מה יש לי מחר", "תראה לי את היומן השבוע", "what's on my schedule", "מה הפגישות שלי השבוע".
- calendar_create — CREATE a calendar event. Examples: "תקבע פגישה היום ב-21:30", "קבע לי פגישה עם דנה ביום שישי", "תוסיף ליומן רופא שיניים מחר ב-10", "schedule a meeting".
- general — anything else (email replies, tasks, memory queries, casual chat, ambiguous/multi-step asks).

Also extract slots. **IMPORTANT — always return all slot fields**, using empty string "" for any not mentioned.

For calendar_list / calendar_create:
- date_phrase: copy the user's raw date words ("היום", "מחר", "השבוע", "ב-15 לחודש", "next Monday").
- time_phrase: (calendar_create only) raw time phrase ("ב21:30", "10 בבוקר", "מ-3 עד 5").
- summary_hint: (calendar_create only) the event title — use the user's words ("פגישה עם אסתר", "רופא שיניים").
- duration_phrase: (calendar_create only) duration if stated ("שעה", "30 דקות").
- calendar_hint: which calendar if specified ("של אסתר", "המשותף", "esterkuper"). Empty string if user didn't specify — DO NOT guess.
- query_hint: (calendar_list only) free-text filter if any.

For email_new — recipient_hint / subject_hint / topic_hint as before.

User message:
"""
${userMessage}
"""

Return JSON matching the schema.`;
        try {
            const response = await this.ai.models.generateContent({
                model: config.geminiModel,
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: intentSchema,
                    temperature: 0,
                },
            });
            const text = response.text?.trim() || '';
            const parsed = JSON.parse(text);
            const blank = (s) => (s && s.trim()) ? s : undefined;
            return {
                intent: parsed.intent || 'general',
                slots: {
                    recipient_hint: blank(parsed.recipient_hint),
                    subject_hint: blank(parsed.subject_hint),
                    topic_hint: blank(parsed.topic_hint),
                    date_phrase: blank(parsed.date_phrase),
                    time_phrase: blank(parsed.time_phrase),
                    summary_hint: blank(parsed.summary_hint),
                    duration_phrase: blank(parsed.duration_phrase),
                    calendar_hint: blank(parsed.calendar_hint),
                    query_hint: blank(parsed.query_hint),
                },
                reasoning: parsed.reasoning,
            };
        }
        catch (err) {
            logger.warn('[intent] classifier failed, defaulting to general:', err);
            return { intent: 'general', slots: {} };
        }
    }
}
let instance = null;
export function getIntentService() {
    if (!instance)
        instance = new IntentService();
    return instance;
}
