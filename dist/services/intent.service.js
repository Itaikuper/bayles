import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
const intentSchema = {
    type: Type.OBJECT,
    properties: {
        intent: {
            type: Type.STRING,
            enum: ['email_new', 'calendar_list', 'calendar_create', 'task_add', 'general'],
            description: 'email_new = compose a brand-new EMAIL draft (not a reply). Requires EXPLICIT email marker. ' +
                'calendar_list = ask about schedule / events / agenda for a date or range. ' +
                'calendar_create = create a calendar event. ' +
                'task_add = add a todo / task, including "turn this into a task" on a forwarded or quoted message. ' +
                'general = anything else (translations, text composition without explicit email marker, email replies, memory queries, casual chat, corrections, multi-step asks).',
        },
        recipient_hint: { type: Type.STRING, description: 'email_new only: WHO to email. Empty string if not mentioned.' },
        subject_hint: { type: Type.STRING, description: 'email_new only: stated subject. Empty string if not mentioned.' },
        topic_hint: { type: Type.STRING, description: 'email_new only: what the email is about. Empty string if not mentioned or if user did NOT provide explicit topic content.' },
        date_phrase: { type: Type.STRING, description: 'calendar_* only: raw date phrase. Empty string if not mentioned.' },
        time_phrase: { type: Type.STRING, description: 'calendar_create only: raw time phrase. Empty string if not mentioned.' },
        summary_hint: { type: Type.STRING, description: 'calendar_create only: event title/short description. Empty string if not mentioned.' },
        duration_phrase: { type: Type.STRING, description: 'calendar_create only: duration phrase. Empty string if not mentioned.' },
        calendar_hint: { type: Type.STRING, description: 'calendar_* only: which calendar to use. Empty string if not mentioned.' },
        query_hint: { type: Type.STRING, description: 'calendar_list only: filter text. Empty string if not mentioned.' },
        reasoning: { type: Type.STRING, description: 'One short Hebrew sentence explaining the chosen intent.' },
    },
    required: ['intent', 'reasoning'],
};
export class IntentService {
    ai;
    constructor() {
        this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    }
    /**
     * Classify an owner-mode message into a coarse intent bucket.
     *
     * Output is ADVISORY — the caller passes it as a hint to the main agent,
     * which may ignore it. Never rely on this to dispatch workflows directly.
     */
    async classify(userMessage, recentHistory) {
        const historyBlock = recentHistory && recentHistory.trim()
            ? `\n\n<RECENT_CONTEXT>\n${recentHistory.trim()}\n</RECENT_CONTEXT>\n\nIf the message looks like a correction, clarification, or continuation of a prior request ("אל תתחכם", "לא, התכוונתי...", "ספציפית ביקשתי..."), classify it based on the ORIGINAL intent that the recent context suggests — not on the correction message alone.`
            : '';
        const prompt = `You are an intent classifier for a Hebrew WhatsApp personal assistant. Your output is an ADVISORY HINT for the main agent — it is NOT used to hijack routing.

Classify the user's message into exactly one of:

- email_new — DRAFT A FRESH NEW GMAIL EMAIL (not a reply). STRICT RULE: only classify as email_new if the user EXPLICITLY asks for email/mail/draft/gmail. Required markers (any of): Hebrew "מייל" / "אימייל" / "דראפט" / "דוא״ל", English "email" / "mail" / "draft" / "gmail", OR an @-address in the message. Verbs alone ("שלח", "כתוב", "תכין", "תנסח") are NOT sufficient without an email marker — these also cover WhatsApp messages, SMS, translation, text composition.
  - "תכין לי הודעה לX" WITHOUT "מייל/email" → general (text composition, NOT email).
  - "תרגם לי הודעה לX" → general (translation, NOT email).
  - "תכין לי מייל לאסתר" → email_new (explicit marker "מייל").

- calendar_list — ask about SCHEDULE / EVENTS / AGENDA for a date or range. Examples: "מה הלוז היום", "מה יש לי מחר", "תראה את היומן השבוע", "what's on my schedule".

- calendar_create — CREATE a calendar event. Examples: "תקבע פגישה היום ב-21:30", "תוסיף ליומן רופא שיניים מחר ב-10", "schedule a meeting".

- task_add — ADD a TODO / task. Triggered by explicit task keywords: Hebrew "משימה", "זאת משימה", "משימה לביצוע", "תוסיף למשימות", "הפוך למשימה", "תהפוך למשימה", "שמע את ההודעה והפוך למשימה", "תזכיר לי", "אני צריך"; English "task", "todo", "add as task", "remind me", "I need to". Includes "turn this into a task" where "this" refers to a forwarded message, a quoted (swipe-reply) message, or the previous conversation turn. Produce this classification even when task content is not in the current message — the agent will pull context from <QUOTED> block or history.

- general — EVERYTHING ELSE. This includes: translations, text composition without explicit email marker, email replies, memory queries, casual chat, corrections to prior requests, ambiguous/multi-step asks.

Slot rules (all optional — leave out or return empty string if not mentioned; do NOT fabricate placeholder values like "הודעה מנומסת"):

For calendar_list / calendar_create:
- date_phrase: copy the user's raw date words.
- time_phrase: (calendar_create only) raw time phrase.
- summary_hint: (calendar_create only) event title in user's words.
- duration_phrase: (calendar_create only) duration if stated.
- calendar_hint: which calendar if specified — DO NOT guess.
- query_hint: (calendar_list only) free-text filter if any.

For email_new:
- recipient_hint, subject_hint: as before.
- topic_hint: the ACTUAL topic content from THIS message. If the user is only clarifying/correcting (e.g., "X היא אשת הכספים של Y"), leave topic_hint empty — do not invent "polite message" etc.${historyBlock}

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
