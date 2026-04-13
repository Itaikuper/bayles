import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
const intentSchema = {
    type: Type.OBJECT,
    properties: {
        intent: {
            type: Type.STRING,
            enum: ['email_new', 'general'],
            description: 'email_new = user wants to compose a brand-new email draft (no reply to an existing thread). general = anything else (reply, calendar, tasks, chat, questions, mixed/composed asks).',
        },
        recipient_hint: {
            type: Type.STRING,
            description: 'Whatever the user said about WHO to email: name, nickname, email address, role. Empty string if not mentioned.',
        },
        subject_hint: {
            type: Type.STRING,
            description: 'Whatever the user said about the email SUBJECT/נושא. Empty string if not mentioned.',
        },
        topic_hint: {
            type: Type.STRING,
            description: 'Whatever the user said about the CONTENT/topic of the email (what it should be about, style, tone, length, etc.). Empty string if not mentioned.',
        },
        reasoning: {
            type: Type.STRING,
            description: 'One short sentence, in Hebrew, explaining the chosen intent. For debugging.',
        },
    },
    required: ['intent', 'recipient_hint', 'subject_hint', 'topic_hint', 'reasoning'],
};
export class IntentService {
    ai;
    constructor() {
        this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    }
    async classify(userMessage) {
        const prompt = `You are an intent classifier for a Hebrew WhatsApp personal assistant.

Classify the user's message into exactly one of:
- email_new: the user wants to DRAFT A FRESH NEW EMAIL (not a reply to an existing thread). Hebrew verbs: "שלח מייל", "כתוב מייל", "תשלח מייל", "תכתוב מייל", "תכין מייל", "תנסח מייל". English: "send email", "write email", "draft email", "compose email".
- general: anything else — replies to threads, calendar, tasks, memory queries, casual chat, composed/multi-step requests.

Also extract the slots:
- recipient_hint: the WHO (name, nickname, role, email). Copy the user's words verbatim if possible.
- subject_hint: the subject/נושא if the user stated one explicitly.
- topic_hint: what the email should be ABOUT — the whole descriptive part beyond the recipient.

User message:
"""
${userMessage}
"""

Return JSON matching the schema. If a slot is not mentioned, return an empty string "" (not null).`;
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
            return {
                intent: parsed.intent,
                slots: {
                    recipient_hint: parsed.recipient_hint || undefined,
                    subject_hint: parsed.subject_hint || undefined,
                    topic_hint: parsed.topic_hint || undefined,
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
