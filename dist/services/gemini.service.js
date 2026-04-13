import { GoogleGenAI, Type } from '@google/genai';
import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getKnowledgeRepository } from '../database/repositories/knowledge.repository.js';
import { getUserMemoryRepository } from '../database/repositories/user-memory.repository.js';
import { getConversationHistoryRepository } from '../database/repositories/conversation-history.repository.js';
import { getChatConfigRepository } from '../database/repositories/chat-config.repository.js';
import { getMemoryService } from './memory.service.js';
// Function declaration for natural language scheduling
const createScheduleDeclaration = {
    name: 'create_schedule',
    description: 'Create a scheduled message. Use when user asks to schedule, remind, or send messages at specific times. Keywords: תזמן, תזכיר, תשלח בשעה, כל יום, מחר, schedule, remind.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            targetName: {
                type: Type.STRING,
                description: 'Target: group name in Hebrew/English, or "self" for current chat. Examples: "קבוצת המשפחה", "self", "לי"',
            },
            hour: {
                type: Type.NUMBER,
                description: 'Hour in 24h format (0-23)',
            },
            minute: {
                type: Type.NUMBER,
                description: 'Minute (0-59). Default to 0 if not specified.',
            },
            days: {
                type: Type.ARRAY,
                items: { type: Type.NUMBER },
                description: 'Days of week for recurring: 0=Sunday, 1=Monday...6=Saturday. Use [0,1,2,3,4,5,6] for "every day", [0,1,2,3,4] for weekdays. Leave empty/null for one-time.',
            },
            oneTimeDate: {
                type: Type.STRING,
                description: 'ISO date (YYYY-MM-DD) for one-time schedule. Use for "tomorrow", "next Monday", specific dates. Calculate from today.',
            },
            message: {
                type: Type.STRING,
                description: 'The message content or AI prompt. If useAi=true, this is the instruction/topic for AI (e.g., "תוכן על פרשת השבוע"). If useAi=false, this is the exact text to send.',
            },
            useAi: {
                type: Type.BOOLEAN,
                description: 'Set to TRUE when the message is a TOPIC or INSTRUCTION for AI to generate content (e.g., "בנושא פרשת השבוע", "על מזג האוויר", "ציטוט מעורר השראה", "בדיחה", "תוכן על X"). Set to FALSE only for EXACT fixed text to send literally (e.g., "בוקר טוב!", "שבת שלום"). When in doubt, use TRUE.',
            },
        },
        required: ['targetName', 'hour', 'minute', 'message', 'useAi'],
    },
};
// Function declaration for song search
const searchSongDeclaration = {
    name: 'search_song',
    description: 'Search for a song with chords/tabs. Use when user asks about a song, chords, tabs, guitar, or wants to play a song. Keywords: שיר, אקורדים, טאבים, גיטרה, chords, song, tabs, לנגן, תנגן, אקורד.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            query: {
                type: Type.STRING,
                description: 'Song title or artist name to search for. Can be partial. Examples: "סוף העולם", "שלמה ארצי", "בואי"',
            },
        },
        required: ['query'],
    },
};
// Function declaration for contact/phone book search
const searchContactDeclaration = {
    name: 'search_contact',
    description: 'Search the phone book / contacts database. Use when user asks for a phone number, contact info, or wants to find someone. Keywords: מספר טלפון, טלפון של, פלאפון, איש קשר, phone, contact, number, מספר של.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            query: {
                type: Type.STRING,
                description: 'Name to search for. Can be partial. Examples: "דוד", "משה כהן", "המספרה"',
            },
        },
        required: ['query'],
    },
};
// Function declaration for Hoshaya village phone directory search
const searchHoshayaDirectoryDeclaration = {
    name: 'search_hoshaya_directory',
    description: 'Search the Hoshaya village phone directory for a resident by name. Use when user asks for a phone number of someone in Hoshaya, or asks to find a resident. IMPORTANT: Use ONLY the name explicitly mentioned in the CURRENT message. Do NOT combine with or infer names from conversation history.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            query: {
                type: Type.STRING,
                description: 'The exact name the user asked about in THIS message ONLY. Extract only what appears in the current message. Examples: if user says "טלפון של עמר" use "עמר", if user says "דוד כהן" use "דוד כהן". Never add names from previous messages.',
            },
        },
        required: ['query'],
    },
};
// Function declaration for managing family chore rotations
const manageChoreRotationDeclaration = {
    name: 'manage_chore_rotation',
    description: `Manage family chore rotations (תורנויות). Use when user talks about chores, rotations, duty, turns, dishwasher duties, garbage, cleaning duties, or asks who is on duty.
Examples:
- "מי מפנה מדיח היום?" → action: "status", rotationName: "פינוי מדיח"
- "מי מכניס מדיח?" → action: "status", rotationName: "הכנסת מדיח"
- "מה התורנות היום?" → action: "list"
- "של מי האשפה?" → action: "status", rotationName: "אשפה"
- "צור תורנות פינוי מדיח עם אביה, אוריה, איתי" → action: "create"
- "הראה את כל התורנויות" → action: "list"
- "תדלג בתורנות מדיח" → action: "advance"
- "תמחק את התורנות של אשפה" → action: "delete"
- "תעדכן את התורנות מדיח: אביה, אוריה, איתי, נועה" → action: "edit"
Keywords: תורנות, תורנויות, תור של, מי היום, של מי, מדיח, אשפה, ניקיון, מי מפנה, מי מכניס, מה התור, chore, rotation, duty.`,
    parameters: {
        type: Type.OBJECT,
        properties: {
            action: {
                type: Type.STRING,
                description: 'Action: "create" (new rotation), "list" (show all), "status" (who is on duty for a specific rotation), "advance" (skip to next person), "delete" (remove rotation), "edit" (update members list).',
            },
            rotationName: {
                type: Type.STRING,
                description: 'Name of the rotation in Hebrew. Examples: "פינוי מדיח", "הכנסת מדיח", "אשפה", "ניקיון סלון". Required for create/status/advance/delete/edit.',
            },
            members: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Ordered list of member names. Required for "create" and "edit". Example: ["אביה", "אוריה", "איתי"]',
            },
            frequency: {
                type: Type.STRING,
                description: 'Rotation frequency: "daily" (default) or "weekly". Only for "create".',
            },
            reminderHour: {
                type: Type.NUMBER,
                description: 'Hour to send daily reminder (0-23). Default 8. Only for "create".',
            },
            reminderMinute: {
                type: Type.NUMBER,
                description: 'Minute for daily reminder (0-59). Default 0. Only for "create".',
            },
        },
        required: ['action'],
    },
};
// Function declaration for sending messages to other people/groups
const sendMessageDeclaration = {
    name: 'send_message',
    description: 'Send a message to another person or group. ALWAYS use this function when the user wants to send/tell/notify someone else, even if phrased as a question (e.g., "תוכל לשלוח...?"). Keywords: תשלח ל, שלח ל, לשלוח הודעה, תגיד ל, תודיע ל, תעביר ל, הודעה ל, send to, tell, forward to.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            targetName: {
                type: Type.STRING,
                description: 'Contact name, group name, or phone number of the recipient. Examples: "דוד", "אמא", "קבוצת המשפחה", "0501234567"',
            },
            messageContent: {
                type: Type.STRING,
                description: 'When generateContent=false: the exact text to send. When generateContent=true: describe WHAT to create (e.g., "שיר אהבה קצר", "ברכת יום הולדת מצחיקה", "שיר לפורים"). Be descriptive about the desired content style and theme.',
            },
            generateContent: {
                type: Type.BOOLEAN,
                description: 'Set to TRUE when the user wants AI to CREATE/COMPOSE content (songs, poems, greetings, stories, creative text). TRUE examples: "שלח שיר אהבה", "שלח ברכה", "שלח משהו יפה", "שלח שיר לפורים". Set to FALSE ONLY when the user specifies the exact literal text to send. FALSE examples: "שלח לדוד שאני מאחר", "שלח לאמא שלום". When in doubt, set to TRUE.',
            },
            timing: {
                type: Type.STRING,
                description: 'When to send: "now" for immediate, or natural language time like "בעוד חצי שעה", "מחר ב-9". Default to "now" if not specified.',
            },
            scheduledDate: {
                type: Type.STRING,
                description: 'ISO date (YYYY-MM-DD) if scheduling for later. Calculate from today.',
            },
            scheduledHour: {
                type: Type.NUMBER,
                description: 'Hour in 24h format (0-23) if scheduling for later.',
            },
            scheduledMinute: {
                type: Type.NUMBER,
                description: 'Minute (0-59) if scheduling for later. Default to 0.',
            },
        },
        required: ['targetName', 'messageContent', 'generateContent'],
    },
};
// Calendar function declarations
const listCalendarEventsDeclaration = {
    name: 'list_calendar_events',
    description: 'List events from the user\'s Google Calendar. Use when user asks about their schedule, events, or calendar. Keywords: מה יש לי, יומן, אירועים, לוח, פגישות, calendar, events, schedule, מה התכנון.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            startDate: {
                type: Type.STRING,
                description: 'Start date in YYYY-MM-DD format. Default to today if not specified.',
            },
            endDate: {
                type: Type.STRING,
                description: 'End date in YYYY-MM-DD format. Default to same as startDate for single day, or end of week/month if range is mentioned.',
            },
            query: {
                type: Type.STRING,
                description: 'Optional search query to filter events by text.',
            },
        },
        required: ['startDate', 'endDate'],
    },
};
const createCalendarEventDeclaration = {
    name: 'create_calendar_event',
    description: 'Create a new event in the user\'s Google Calendar. Use when user wants to add an event, meeting, or appointment. Keywords: תוסיף אירוע, תקבע פגישה, תכניס ליומן, הוסף, add event, create meeting.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            summary: {
                type: Type.STRING,
                description: 'Event title/summary. Examples: "פגישה עם דוד", "ארוחת ערב", "שיעור גיטרה"',
            },
            date: {
                type: Type.STRING,
                description: 'Event date in YYYY-MM-DD format. Calculate from today for relative dates like "מחר", "ביום שלישי".',
            },
            startHour: {
                type: Type.NUMBER,
                description: 'Start hour in 24h format (0-23).',
            },
            startMinute: {
                type: Type.NUMBER,
                description: 'Start minute (0-59). Default to 0 if not specified.',
            },
            durationMinutes: {
                type: Type.NUMBER,
                description: 'Duration in minutes. Default to 60 if not specified.',
            },
        },
        required: ['summary', 'date', 'startHour'],
    },
};
const updateCalendarEventDeclaration = {
    name: 'update_calendar_event',
    description: 'Update an existing event in the user\'s Google Calendar. Use when user wants to change, move, or modify an event. Keywords: תשנה, תזיז, תעדכן, עדכן, שנה, הזז, update, change, move.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            searchQuery: {
                type: Type.STRING,
                description: 'Text to search for to find the event to update. Example: "פגישה עם דוד"',
            },
            searchDate: {
                type: Type.STRING,
                description: 'Date to search for the event in YYYY-MM-DD format.',
            },
            newSummary: {
                type: Type.STRING,
                description: 'New title for the event (if changing title).',
            },
            newDate: {
                type: Type.STRING,
                description: 'New date in YYYY-MM-DD format (if moving to different date).',
            },
            newStartHour: {
                type: Type.NUMBER,
                description: 'New start hour in 24h format (if changing time).',
            },
            newStartMinute: {
                type: Type.NUMBER,
                description: 'New start minute (if changing time).',
            },
        },
        required: ['searchQuery', 'searchDate'],
    },
};
const deleteCalendarEventDeclaration = {
    name: 'delete_calendar_event',
    description: 'Delete an event from the user\'s Google Calendar. Use when user wants to cancel or remove an event. Keywords: תמחק אירוע, תבטל, בטל פגישה, delete event, cancel, remove.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            searchQuery: {
                type: Type.STRING,
                description: 'Text to search for to find the event to delete. Example: "פגישה עם דוד"',
            },
            searchDate: {
                type: Type.STRING,
                description: 'Date to search for the event in YYYY-MM-DD format.',
            },
        },
        required: ['searchQuery', 'searchDate'],
    },
};
// --- Gmail (private, owner-JID only) ---
const gmailListRecentDeclaration = {
    name: 'gmail_list_recent_emails',
    description: 'List recent Gmail emails. Use when the owner asks to see/check their inbox, list new mail, see mail from a label, or search. Keywords: מיילים, תיבה, מה חדש במייל, בדוק מייל, inbox, emails.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            labelName: { type: Type.STRING, description: 'Optional label name to filter by (must be a watched label).' },
            query: { type: Type.STRING, description: 'Optional Gmail search query (e.g. "from:boss@x.com newer_than:2d").' },
            max: { type: Type.NUMBER, description: 'Max number of results (default 10, max 20).' },
        },
    },
};
const gmailReadEmailDeclaration = {
    name: 'gmail_read_email',
    description: 'Read the full body of a specific Gmail message by its id. Use when you need the content before summarizing or drafting a reply.',
    parameters: {
        type: Type.OBJECT,
        properties: { messageId: { type: Type.STRING, description: 'Gmail message id.' } },
        required: ['messageId'],
    },
};
const gmailDraftReplyDeclaration = {
    name: 'gmail_draft_reply',
    description: 'Create a DRAFT reply to an EXISTING Gmail message (never sends). Before calling, if you do not have the original message body in context, call gmail_read_email(messageId) first so your reply is grounded in what they actually wrote.\n\nBody: greeting by the sender\'s first name, substantive content (answer, action plan, or acknowledgment), closing line, blank line, signature from core memory. Match the language of the original email. No "AI-generated" disclaimers.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            messageId: { type: Type.STRING, description: 'Gmail id of the message to reply to.' },
            body: { type: Type.STRING, description: 'Full reply body including greeting + content + closing + signature. Use real newlines.' },
        },
        required: ['messageId', 'body'],
    },
};
const gmailDraftNewDeclaration = {
    name: 'gmail_draft_new',
    description: 'Create a DRAFT of a brand-new email (not a reply; no existing thread). Never sends. Before calling this, you should have already called gmail_list_recent_emails for this recipient to check context — if the current task is clearly a follow-up to an existing thread, use gmail_draft_reply instead.\n\nSubject: short, specific, professional. Body: greeting by name, 1–3 paragraphs of substance, closing line, blank line, then the signature from the "Email signature" section of core memory (e.g. "Best regards,\\nItai Kuperstoch"). No "AI-generated" disclaimers. Match the language of the most recent thread with the recipient; default to English for business unless Itai asked for Hebrew.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            to: { type: Type.STRING, description: 'Recipient email address. Accept "Name <addr@x.com>" or plain "addr@x.com".' },
            subject: { type: Type.STRING, description: 'Subject line — specific, not generic "Update".' },
            body: { type: Type.STRING, description: 'Full email body including greeting + content + closing + signature. Use real newlines. Do NOT repeat the subject inside the body.' },
        },
        required: ['to', 'subject', 'body'],
    },
};
const gmailAddWatchLabelDeclaration = {
    name: 'gmail_add_watch_label',
    description: 'Start monitoring a Gmail label for new emails. The label must already exist in Gmail. Keywords: עקוב אחרי תווית, תתחיל לעקוב, watch label.',
    parameters: {
        type: Type.OBJECT,
        properties: { labelName: { type: Type.STRING } },
        required: ['labelName'],
    },
};
const gmailRemoveWatchLabelDeclaration = {
    name: 'gmail_remove_watch_label',
    description: 'Stop monitoring a Gmail label. Keywords: הפסק לעקוב, unwatch, remove label.',
    parameters: {
        type: Type.OBJECT,
        properties: { labelName: { type: Type.STRING } },
        required: ['labelName'],
    },
};
const gmailListWatchLabelsDeclaration = {
    name: 'gmail_list_watch_labels',
    description: 'List which Gmail labels are being monitored. Keywords: אילו תוויות, which labels.',
    parameters: { type: Type.OBJECT, properties: {} },
};
const gmailAddWatchSenderDeclaration = {
    name: 'gmail_add_watch_sender',
    description: 'Watch a specific sender email address — the bot will notify on every new email from this address. Keywords: עקוב אחרי המיילים מ-, watch sender.',
    parameters: {
        type: Type.OBJECT,
        properties: { email: { type: Type.STRING } },
        required: ['email'],
    },
};
const gmailRemoveWatchSenderDeclaration = {
    name: 'gmail_remove_watch_sender',
    description: 'Stop watching a sender. Keywords: הפסק לעקוב אחרי, unwatch sender.',
    parameters: {
        type: Type.OBJECT,
        properties: { email: { type: Type.STRING } },
        required: ['email'],
    },
};
const gmailListWatchSendersDeclaration = {
    name: 'gmail_list_watch_senders',
    description: 'List which sender email addresses are being monitored.',
    parameters: { type: Type.OBJECT, properties: {} },
};
const gmailBlockSenderDeclaration = {
    name: 'gmail_block_sender',
    description: 'Suppress personal-inbox notifications for any email whose From header contains this substring. Use when Itai wants to stop getting pinged about a specific sender or domain (e.g., "חסום bezeq", "block @iec.co.il", "אל תעדכן אותי מ-paybox"). Pattern examples: "bezeq", "@iec.co.il", "marketing@partner.co.il".',
    parameters: {
        type: Type.OBJECT,
        properties: {
            pattern: { type: Type.STRING, description: 'Substring to match against the From header (case-insensitive). Prefer "@domain.tld" for whole-domain blocks, or a full email address for one sender.' },
        },
        required: ['pattern'],
    },
};
const gmailUnblockSenderDeclaration = {
    name: 'gmail_unblock_sender',
    description: 'Remove a pattern from the personal-inbox blocklist. Keywords: "בטל חסימה", "unblock", "תחזיר את X לחסימה".',
    parameters: {
        type: Type.OBJECT,
        properties: { pattern: { type: Type.STRING } },
        required: ['pattern'],
    },
};
const gmailListBlockedDeclaration = {
    name: 'gmail_list_blocked',
    description: 'Show the list of blocked substrings for personal-inbox notifications. Keywords: "מה חסום", "מי חסום", "list blocked".',
    parameters: { type: Type.OBJECT, properties: {} },
};
const gmailEnablePersonalInboxDeclaration = {
    name: 'gmail_enable_personal_inbox',
    description: 'Turn ON notifications for personal emails landing in the Gmail Primary tab. Keywords: "הפעל מעקב דואר אישי", "start personal inbox".',
    parameters: { type: Type.OBJECT, properties: {} },
};
const gmailDisablePersonalInboxDeclaration = {
    name: 'gmail_disable_personal_inbox',
    description: 'Turn OFF notifications for personal emails landing in the Gmail Primary tab (watched labels and senders still notify). Keywords: "בטל מעקב דואר אישי", "pause personal inbox".',
    parameters: { type: Type.OBJECT, properties: {} },
};
// --- Memory (owner mode) ---
const searchMemoryDeclaration = {
    name: 'search_memory',
    description: 'Search the persistent memory (people and project notes) for what we know about someone or something. Use whenever the owner mentions a name or project you might have notes on.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            query: { type: Type.STRING, description: 'Keyword(s) to search for, e.g. a person name or project name.' },
            category: { type: Type.STRING, description: 'Optional: "people" or "projects" to limit the search.' },
        },
        required: ['query'],
    },
};
const updateCoreMemoryDeclaration = {
    name: 'update_core_memory',
    description: 'Add a durable fact (lasts 30+ days) to the always-loaded core memory under a section heading. Use when the owner reveals a preference, identity detail, standing instruction, or new active project. Examples: section="Preferences", fact="הוא מעדיף פגישות אחרי 10 בבוקר".',
    parameters: {
        type: Type.OBJECT,
        properties: {
            section: { type: Type.STRING, description: 'Section heading inside core.md, e.g. "Preferences", "Active projects", "Key people", "Standing instructions".' },
            fact: { type: Type.STRING, description: 'A single short bullet line. The bot will prepend "- " automatically.' },
        },
        required: ['section', 'fact'],
    },
};
const appendPersonNoteDeclaration = {
    name: 'append_person_note',
    description: 'Append a dated note to a person\'s profile file. Use after a meeting or when the owner shares context about someone.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            person: { type: Type.STRING, description: 'Person name or email.' },
            note: { type: Type.STRING, description: 'The note text. Keep it short.' },
        },
        required: ['person', 'note'],
    },
};
const appendProjectNoteDeclaration = {
    name: 'append_project_note',
    description: 'Append a dated note to a project\'s file. Use to log decisions, status updates, or links related to an active project.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            project: { type: Type.STRING, description: 'Project name.' },
            note: { type: Type.STRING, description: 'The note text.' },
        },
        required: ['project', 'note'],
    },
};
// --- Tasks (owner mode) ---
const addTaskDeclaration = {
    name: 'add_task',
    description: 'Add a task / TODO. Use when the owner says "תזכיר לי", "אני צריך", "תוסיף משימה", "remind me to", "I need to", or otherwise asks to track something to do. If a due date/time is given, set due_iso to ISO 8601.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            title: { type: Type.STRING, description: 'Short task title in Hebrew.' },
            due_iso: { type: Type.STRING, description: 'Optional due time in ISO 8601 (e.g. 2026-04-14T10:00:00+03:00). Leave empty if no time given.' },
            notes: { type: Type.STRING, description: 'Optional longer notes.' },
        },
        required: ['title'],
    },
};
const listTasksDeclaration = {
    name: 'list_tasks',
    description: 'List the owner\'s tasks. Use when asked "מה המשימות שלי?", "what\'s on my list?", "מה יש לי לעשות?".',
    parameters: {
        type: Type.OBJECT,
        properties: {
            filter: { type: Type.STRING, description: 'Optional filter: "active" (default — pending+due-snoozed), "pending", "done", "snoozed", or "all".' },
        },
    },
};
const completeTaskDeclaration = {
    name: 'complete_task',
    description: 'Mark a task as done. Provide either id (preferred) or query (substring of title). Use when the owner says "סיימתי X", "X done", "תסמן את X".',
    parameters: {
        type: Type.OBJECT,
        properties: {
            id: { type: Type.NUMBER, description: 'Task id (preferred).' },
            query: { type: Type.STRING, description: 'Substring of the task title — used if id is unknown.' },
        },
    },
};
const snoozeTaskDeclaration = {
    name: 'snooze_task',
    description: 'Snooze a task until later. Provide id or query, plus until_iso (ISO 8601).',
    parameters: {
        type: Type.OBJECT,
        properties: {
            id: { type: Type.NUMBER },
            query: { type: Type.STRING },
            until_iso: { type: Type.STRING, description: 'When to surface again, ISO 8601.' },
        },
        required: ['until_iso'],
    },
};
export class GeminiService {
    ai;
    conversationHistory = new Map();
    maxHistoryLength = 20; // Keep last 20 message pairs per conversation
    constructor() {
        this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    }
    getImageInstructions() {
        if (!config.autoImageGeneration)
            return '';
        return `

יש לך יכולת ליצור תמונות (גרפים, דיאגרמות, איורים, אינפוגרפיקות) באמצעות תגיות מיוחדות.

מתי להשתמש:
- כשהמשתמש מבקש במפורש לייצר תמונה/גרף/אינפוגרפיקה/איור - הכנס תגית מיד, בלי לתאר מילולית מה תהיה התמונה.
- כשהמשתמש אומר "כן"/"בוא"/"תייצר" בתגובה להצעה שלך - הכנס תגית מיד.
- כשאתה חושב שתמונה תעזור אבל המשתמש לא ביקש - הצע בקצרה: "רוצה שאייצר גרף/איור של זה?"

פורמט התגית:
[IMAGE: actual English description of the specific image]
[PRO_IMAGE: actual English description, use this when image needs Hebrew text]

דוגמה נכונה - אם לימדת על סינוסים ובקשו גרף:
[IMAGE: mathematical graph showing y=sin(x) curve from 0 to 2pi, with x-axis marked at pi/2, pi, 3pi/2, 2pi, y-axis from -1 to 1, blue curve on white grid]

דוגמה נכונה - אם לימדת גמרא מנחות על ציץ ובקשו אינפוגרפיקה:
[PRO_IMAGE: educational infographic about the Tzitz (golden head plate), split into two sections: left side shows green checkmark with title in Hebrew "מכפר על טומאה" listing tumah of kohen and korban, right side shows red X with title in Hebrew "לא מכפר על יוצא" explaining korban that left its boundary is completely invalid]

כללים:
1. התיאור חייב להיות תוכן אמיתי וספציפי לנושא השיחה - לא תבנית כללית!
2. אל תתאר את התמונה במילים בטקסט. פשוט הכנס את התגית וזהו.
3. טקסט בעברית בתמונה = PRO_IMAGE.
4. מקסימום תגית אחת בתשובה.`;
    }
    /**
     * Returns the assistant mode for a given chat. Owner DM gets a focused personal-assistant prompt
     * with eager tool use and no image auto-generation. Default chats keep current behavior.
     */
    isOwnerMode(jid, senderJid) {
        return this.getAssistantMode(jid, senderJid) === 'owner';
    }
    getAssistantMode(jid, senderJid) {
        if (!config.gmailOwnerJid)
            return 'default';
        if (jid === config.gmailOwnerJid)
            return 'owner';
        if (senderJid === config.gmailOwnerJid && !jid.endsWith('@g.us'))
            return 'owner';
        return 'default';
    }
    async generateResponse(jid, userMessage, customPrompt, tenantId = 'default', senderJid) {
        try {
            const mode = this.getAssistantMode(jid, senderJid);
            // Get or initialize conversation history (scoped by tenant)
            const historyKey = `${tenantId}:${jid}`;
            const history = this.conversationHistory.get(historyKey) ?? this.loadHistoryFromDb(historyKey, jid, tenantId);
            // Get knowledge base for this chat (skipped in owner mode — handled by MemoryService in later step)
            const knowledgeRepo = getKnowledgeRepository();
            const knowledgeContext = mode === 'owner' ? '' : knowledgeRepo.getFormattedKnowledge(jid);
            // Get user memories for the sender (only if enabled for this chat)
            const chatConfigRepo = getChatConfigRepository();
            const memoryRepo = getUserMemoryRepository();
            const injectMemory = chatConfigRepo.shouldInjectMemory(jid);
            const userMemories = injectMemory
                ? memoryRepo.getFormattedMemories(senderJid || jid, tenantId)
                : '';
            // Get conversation summaries from compaction
            const convRepo = getConversationHistoryRepository();
            const summaries = convRepo.getFormattedSummaries(jid, tenantId);
            // Privacy guardrail: when memory injection is disabled, instruct the model to not reveal personal info
            const privacyGuardrail = !injectMemory
                ? '\n\nCRITICAL PRIVACY RULE: You must NEVER reveal, share, or reference any personal information about any user — not from memory, not from conversation history, not from summaries. If asked "what do you know about me" or similar, respond that you don\'t store personal information in this chat. This rule overrides all other instructions.'
                : '';
            // Owner mode: focused personal-assistant prompt, no image instructions, no knowledge-base noise.
            // Default mode: existing behavior (custom prompt + knowledge + image instructions).
            const imageInstructions = mode === 'owner' ? '' : this.getImageInstructions();
            let ownerMemorySection = '';
            if (mode === 'owner') {
                try {
                    const memSvc = getMemoryService();
                    const core = await memSvc.readCore();
                    const daily = await memSvc.readRecentDaily(2);
                    ownerMemorySection = `\n\n<CORE_MEMORY>\n${core.trim()}\n</CORE_MEMORY>\n\n<RECENT_DAYS>\n${daily || '(no recent notes)'}\n</RECENT_DAYS>`;
                }
                catch (err) {
                    logger.warn('MemoryService failed to load owner memory:', err);
                }
            }
            const baseIdentity = mode === 'owner'
                ? `You are Itai's executive assistant. You operate like a real EA at a senior manager — Itai gives short task instructions, you execute them with care, fluently and professionally. Default language: Hebrew. Replies to Itai are concise (≤150 words) and in his language. NEVER generate images unless he explicitly invokes /image or /proimage.

When asked anything that maps to a tool (mail, calendar, tasks, memory), CALL THE TOOL — never guess, never say "I don't have access".

EMAIL DRAFTING RULES (critical — you draft, never send):

1. CREATE the content; do NOT transcribe the instruction. When Itai describes WHAT the email should contain ("write a poem", "summarize Q3 results", "thank them for the proposal", "invite him to dinner"), you must actually PRODUCE that content — write the poem, write the summary, write the invitation. Do not put Itai's meta-instruction into the body. Example of the bug to avoid:
   - Instruction: "בגוף כתוב שיר יפה ומרגש" (body should have a beautiful emotional poem)
   - WRONG body: "שיר יפה ומרגש"  ← literally quoting the instruction
   - RIGHT body: an actual 4–8 line poem that fits the subject/recipient.

2. Before drafting ANY email to a named recipient (new or reply), first call gmail_list_recent_emails with q="from:<email> OR to:<email>" (max=5) to inspect recent thread context. If there is a relevant prior thread that looks like the same topic, prefer gmail_draft_reply to that message instead of gmail_draft_new.

3. Register: match the relationship. Business contact → polite, direct, professional, no emojis. Family/personal (e.g., wife, close friend) → warm, personal, natural tone, emojis OK if the thread uses them.

4. Language: match the recipient's last correspondence. If none, use Itai's instruction language for personal/family recipients; default to professional English for business contacts unless Itai specified otherwise. For Hebrew recipients write Hebrew.

5. Structure — ALWAYS include all four parts, even for short/creative emails:
   a. Subject: specific and meaningful (not "Update", not a transcription of the instruction).
   b. Greeting by first name: "Dear <FirstName>," / "היי <שם>," / "אסתר שלי," for intimate cases.
   c. Body: the actual content you've generated (paragraphs separated by blank lines).
   d. Closing + signature: a closing line when appropriate, then blank line, then the signature from core memory ("## Email signature" section). NEVER skip the signature.

6. After creating the draft, the WhatsApp confirmation (with the link) is sent automatically — do NOT also send a text summary yourself.

When Itai reveals a durable preference, identity detail, or active project, call update_core_memory. After meetings or when context is shared about a person/project, call append_person_note / append_project_note.${ownerMemorySection}`
                : (customPrompt || config.systemPrompt);
            const systemPrompt = baseIdentity + knowledgeContext + userMemories + summaries + imageInstructions + privacyGuardrail;
            // Get today's date for scheduling context
            const today = new Date();
            const dateContext = `Today is ${today.toISOString().split('T')[0]} (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][today.getDay()]}).`;
            // Capability context — differs per mode.
            const capabilityContext = mode === 'owner'
                ? `
You have these tools for Itai's private assistant mode:
- Calendar: list_calendar_events, create_calendar_event, update_calendar_event, delete_calendar_event
- Gmail (read + drafts only, NEVER send): gmail_list_recent_emails, gmail_read_email, gmail_draft_reply, gmail_add_watch_label, gmail_remove_watch_label, gmail_list_watch_labels
- Scheduled reminders: create_schedule
Rules: Call tools eagerly. If the user asks about their schedule/meetings/mail/drafts in ANY phrasing, CALL THE TOOL. Never respond with "I don't have access" — you do have access. Messages in [brackets] in history are records of actions you performed; trust them.`
                : `
You have real capabilities through function calling: send messages to other people (send_message), schedule messages (create_schedule), search songs (search_song), search contacts (search_contact), search Hoshaya village phone directory (search_hoshaya_directory), manage calendar events, and manage family chore rotations (manage_chore_rotation).
CRITICAL: For ANY phone number or contact lookup, you MUST call search_hoshaya_directory. NEVER answer phone queries from memory or conversation history. You do NOT know any phone numbers - always call the function.
Messages in [brackets] in conversation history are factual records of actions you performed. Trust them completely — if it says [שלחתי הודעה ל...], you DID send that message. Never deny or contradict these records.`;
            const allowedTools = chatConfigRepo.getAllowedTools(jid);
            const isAllowed = (toolName) => allowedTools === null || allowedTools.includes(toolName);
            const functionDeclarations = [];
            if (mode === 'owner') {
                // Owner mode: always include the full personal-assistant tool set. No keyword regex gates.
                // Let Gemini decide when to call each tool based on the message + system prompt.
                functionDeclarations.push(listCalendarEventsDeclaration, createCalendarEventDeclaration, updateCalendarEventDeclaration, deleteCalendarEventDeclaration, gmailListRecentDeclaration, gmailReadEmailDeclaration, gmailDraftReplyDeclaration, gmailDraftNewDeclaration, gmailAddWatchLabelDeclaration, gmailRemoveWatchLabelDeclaration, gmailListWatchLabelsDeclaration, gmailAddWatchSenderDeclaration, gmailRemoveWatchSenderDeclaration, gmailListWatchSendersDeclaration, gmailBlockSenderDeclaration, gmailUnblockSenderDeclaration, gmailListBlockedDeclaration, gmailEnablePersonalInboxDeclaration, gmailDisablePersonalInboxDeclaration, createScheduleDeclaration, searchMemoryDeclaration, updateCoreMemoryDeclaration, appendPersonNoteDeclaration, appendProjectNoteDeclaration, addTaskDeclaration, listTasksDeclaration, completeTaskDeclaration, snoozeTaskDeclaration);
            }
            else {
                // Default mode: existing keyword-gated tool selection.
                const schedulingKeywords = /תזמן|תזכיר|תשלח בשעה|כל יום|מחר בשעה|schedule|remind|תקבע|הזכר לי|בשעה \d/i;
                const songKeywords = /שיר|אקורד|טאב|גיטרה|chord|song|tab|לנגן|תנגן|אקורד/i;
                const contactKeywords = /טלפון|פלאפון|מספר של|איש קשר|phone|contact|number/i;
                const hoshayaDirectoryKeywords = /הושעיה|טלפון של|מספר של|ספר טלפונים|מי גר ב|תושב|טלפון|פלאפון|מספר של|איש קשר|phone|contact|number/i;
                const calendarKeywords = /מה יש לי|יומן|אירוע|פגיש|לוח|לוז|תוסיף אירוע|תקבע פגישה|תכניס ליומן|תמחק אירוע|תבטל פגישה|תשנה אירוע|תזיז|תעדכן אירוע|calendar|events|meeting|schedule|agenda/i;
                const sendMessageKeywords = /תשלח ל|שלח ל|שלח .{1,30} ל|לשלוח ל|לשלוח .{1,30} ל|לשלוח הודעה|תגיד ל|תודיע ל|תעביר ל|הודעה ל|send to|send .{1,30} to|tell .+ that|forward to|למספר \d/i;
                const choreKeywords = /תורנות|תורנויות|תור של|מי היום|של מי (ה|ל)?|מדיח|אשפה|ניקיון|מי מפנה|מי מכניס|מה התור|chore|rotation|duty/i;
                const toolHistoryKey = `${tenantId}:${jid}`;
                const recentHistory = this.conversationHistory.get(toolHistoryKey) ?? [];
                const hasRecentDirectorySearch = recentHistory.slice(-4).some(m => m.role === 'model' && m.parts?.some(p => p.text?.includes('חיפשתי בספר הטלפונים של הושעיה')));
                if (schedulingKeywords.test(userMessage) && isAllowed('create_schedule'))
                    functionDeclarations.push(createScheduleDeclaration);
                if (songKeywords.test(userMessage) && isAllowed('search_song'))
                    functionDeclarations.push(searchSongDeclaration);
                if (contactKeywords.test(userMessage) && isAllowed('search_contact'))
                    functionDeclarations.push(searchContactDeclaration);
                if ((hoshayaDirectoryKeywords.test(userMessage) || hasRecentDirectorySearch) && isAllowed('search_hoshaya_directory'))
                    functionDeclarations.push(searchHoshayaDirectoryDeclaration);
                if (calendarKeywords.test(userMessage) && isAllowed('list_calendar_events')) {
                    functionDeclarations.push(listCalendarEventsDeclaration, createCalendarEventDeclaration, updateCalendarEventDeclaration, deleteCalendarEventDeclaration);
                }
                if (sendMessageKeywords.test(userMessage) && isAllowed('send_message'))
                    functionDeclarations.push(sendMessageDeclaration);
                if (choreKeywords.test(userMessage) && isAllowed('manage_chore_rotation'))
                    functionDeclarations.push(manageChoreRotationDeclaration);
            }
            const isFunctionCallRequest = functionDeclarations.length > 0;
            // Owner mode skips googleSearch entirely (SDK bug: googleSearch + functionDeclarations can't coexist).
            // Default mode falls back to googleSearch when no functions match.
            const tools = isFunctionCallRequest
                ? [{ functionDeclarations }]
                : (mode === 'owner' ? [] : [{ googleSearch: {} }]);
            const chat = this.ai.chats.create({
                model: config.geminiModel,
                config: {
                    tools,
                },
                history: [
                    // Add system instruction as first message pair
                    {
                        role: 'user',
                        parts: [{ text: `System instruction: ${systemPrompt}\n\n${dateContext}${capabilityContext}` }],
                    },
                    {
                        role: 'model',
                        parts: [{ text: 'Understood. I will follow these instructions.' }],
                    },
                    ...history,
                ],
            });
            // Send message and get response
            const response = await chat.sendMessage({
                message: userMessage,
            });
            // Check for function calls first
            if (response.functionCalls && response.functionCalls.length > 0) {
                const functionCall = response.functionCalls[0];
                if (functionCall.name) {
                    logger.info(`Function call detected: ${functionCall.name}`, functionCall.args);
                    // Don't update history for function calls (the action will be handled separately)
                    return {
                        type: 'function_call',
                        functionCall: {
                            name: functionCall.name,
                            args: (functionCall.args || {}),
                        },
                    };
                }
            }
            const responseText = response.text || 'Sorry, I could not generate a response.';
            // Update history
            history.push({ role: 'user', parts: [{ text: userMessage }] }, { role: 'model', parts: [{ text: responseText }] });
            // Trim history if too long
            while (history.length > this.maxHistoryLength * 2) {
                history.shift();
            }
            this.conversationHistory.set(historyKey, history);
            // Persist to DB
            getConversationHistoryRepository().addExchange(jid, userMessage, responseText, tenantId);
            return { type: 'text', text: responseText };
        }
        catch (error) {
            logger.error('Gemini API error:', error);
            return { type: 'text', text: 'Sorry, I encountered an error processing your request.' };
        }
    }
    async generateAudioResponse(jid, audioBuffer, mimeType, customPrompt, contextPrefix, tenantId = 'default', senderJid) {
        try {
            const mode = this.getAssistantMode(jid, senderJid);
            const historyKey = `${tenantId}:${jid}`;
            const history = this.conversationHistory.get(historyKey) ?? this.loadHistoryFromDb(historyKey, jid, tenantId);
            const knowledgeRepo = getKnowledgeRepository();
            const knowledgeContext = mode === 'owner' ? '' : knowledgeRepo.getFormattedKnowledge(jid);
            // Load user memories for the sender
            const memoryRepo = getUserMemoryRepository();
            const userMemories = memoryRepo.getFormattedMemories(senderJid || jid, tenantId);
            // Get conversation summaries from compaction
            const convRepo = getConversationHistoryRepository();
            const summaries = convRepo.getFormattedSummaries(jid, tenantId);
            const imageInstructions = mode === 'owner' ? '' : this.getImageInstructions();
            const baseIdentity = mode === 'owner'
                ? `You are Itai's personal assistant. Hebrew by default. Concise, direct. NEVER auto-generate images.`
                : (customPrompt || config.systemPrompt);
            const systemPrompt = baseIdentity + knowledgeContext + userMemories + summaries + imageInstructions;
            const chat = this.ai.chats.create({
                model: config.geminiModel,
                config: {
                    tools: [{ googleSearch: {} }],
                },
                history: [
                    {
                        role: 'user',
                        parts: [{ text: `System instruction: ${systemPrompt}` }],
                    },
                    {
                        role: 'model',
                        parts: [{ text: 'Understood. I will follow these instructions.' }],
                    },
                    ...history,
                ],
            });
            const base64Audio = audioBuffer.toString('base64');
            const voiceInstruction = 'הקובץ המצורף הוא הקלטת אודיו של המשתמש. הקשב והגב ישירות לתוכן, בלי לצטט או לחזור על מה שנאמר.';
            const textPrompt = contextPrefix
                ? `${contextPrefix} ${voiceInstruction}`
                : voiceInstruction;
            const response = await chat.sendMessage({
                message: [
                    { inlineData: { mimeType, data: base64Audio } },
                    textPrompt,
                ],
            });
            const responseText = response.text || 'Sorry, I could not understand the voice message.';
            // Store text placeholder in history (not the audio blob)
            const historyLabel = contextPrefix
                ? `${contextPrefix} [הודעה קולית]`
                : '[הודעה קולית]';
            history.push({ role: 'user', parts: [{ text: historyLabel }] }, { role: 'model', parts: [{ text: responseText }] });
            while (history.length > this.maxHistoryLength * 2) {
                history.shift();
            }
            this.conversationHistory.set(historyKey, history);
            // Persist to DB
            convRepo.addExchange(jid, historyLabel, responseText, tenantId);
            return responseText;
        }
        catch (error) {
            logger.error('Gemini audio API error:', error);
            return 'Sorry, I encountered an error processing the voice message.';
        }
    }
    async transcribeAudio(audioBuffer, mimeType) {
        try {
            const base64Audio = audioBuffer.toString('base64');
            const response = await this.ai.models.generateContent({
                model: config.geminiModel,
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { inlineData: { mimeType, data: base64Audio } },
                            { text: 'תמלל את ההקלטה מילה במילה. כתוב רק את מה שנאמר, בלי הקדמה, בלי סיכום, בלי פרשנות. אם אין דיבור, כתוב "לא זוהה דיבור".' },
                        ],
                    },
                ],
            });
            return response.text || 'לא הצלחתי לתמלל את ההקלטה.';
        }
        catch (error) {
            logger.error('Gemini transcription error:', error);
            return 'שגיאה בתמלול ההקלטה. נסה שוב.';
        }
    }
    async generateDocumentAnalysisResponse(jid, mediaBuffer, mimeType, caption, customPrompt, contextPrefix, fileName, tenantId = 'default') {
        try {
            const mode = this.getAssistantMode(jid);
            const historyKey = `${tenantId}:${jid}`;
            const history = this.conversationHistory.get(historyKey) ?? this.loadHistoryFromDb(historyKey, jid, tenantId);
            const knowledgeRepo = getKnowledgeRepository();
            const knowledgeContext = mode === 'owner' ? '' : knowledgeRepo.getFormattedKnowledge(jid);
            // Get conversation summaries from compaction
            const convRepo = getConversationHistoryRepository();
            const summaries = convRepo.getFormattedSummaries(jid, tenantId);
            const imageInstructions = mode === 'owner' ? '' : this.getImageInstructions();
            const baseIdentity = mode === 'owner'
                ? `You are Itai's personal assistant. Hebrew by default. Concise, direct. NEVER auto-generate images.`
                : (customPrompt || config.systemPrompt);
            const systemPrompt = baseIdentity + knowledgeContext + summaries + imageInstructions;
            const chat = this.ai.chats.create({
                model: config.geminiModel,
                config: {
                    tools: [{ googleSearch: {} }],
                },
                history: [
                    {
                        role: 'user',
                        parts: [{ text: `System instruction: ${systemPrompt}` }],
                    },
                    {
                        role: 'model',
                        parts: [{ text: 'Understood. I will follow these instructions.' }],
                    },
                    ...history,
                ],
            });
            const base64Media = mediaBuffer.toString('base64');
            // If user sent a caption, use it as instruction; otherwise show learning menu
            let textPrompt;
            if (caption) {
                const prefix = contextPrefix ? `${contextPrefix} ` : '';
                textPrompt = `${prefix}המשתמש שלח תמונה/מסמך${fileName ? ` (${fileName})` : ''} עם ההוראה: "${caption}". נתח את התוכן ובצע את מה שהמשתמש מבקש.`;
            }
            else {
                const prefix = contextPrefix ? `${contextPrefix} ` : '';
                textPrompt = `${prefix}המשתמש שלח תמונה/מסמך${fileName ? ` (${fileName})` : ''}. נתח את התוכן בקצרה והצג למשתמש את האפשרויות הבאות:

1. 📚 חזרה לקראת מבחן - סיכום והדגשת נקודות מפתח
2. ✏️ עזרה בפתרון תרגיל - הדרכה שלב אחר שלב
3. 📝 סיכום החומר - תמצית קצרה ומסודרת
4. ❓ שאלות תרגול - יצירת שאלות על החומר

שאל את המשתמש מה הוא רוצה לעשות עם החומר.`;
            }
            const response = await chat.sendMessage({
                message: [
                    { inlineData: { mimeType, data: base64Media } },
                    textPrompt,
                ],
            });
            const responseText = response.text || 'סליחה, לא הצלחתי לנתח את המסמך.';
            // Store text placeholder in history (not the media blob)
            const mediaLabel = fileName ? `[קובץ: ${fileName}]` : '[תמונה]';
            const historyText = caption
                ? `${contextPrefix ? contextPrefix + ' ' : ''}${mediaLabel} ${caption}`
                : `${contextPrefix ? contextPrefix + ' ' : ''}${mediaLabel}`;
            history.push({ role: 'user', parts: [{ text: historyText }] }, { role: 'model', parts: [{ text: responseText }] });
            while (history.length > this.maxHistoryLength * 2) {
                history.shift();
            }
            this.conversationHistory.set(historyKey, history);
            // Persist to DB
            getConversationHistoryRepository().addExchange(jid, historyText, responseText, tenantId);
            return responseText;
        }
        catch (error) {
            logger.error('Gemini document analysis error:', error);
            return 'סליחה, לא הצלחתי לנתח את המסמך. נסה שוב.';
        }
    }
    async generateImage(prompt, pro = false) {
        try {
            const model = pro ? 'gemini-3-pro-image-preview' : 'gemini-2.5-flash-image';
            logger.info(`Generating image with model: ${model}`);
            const response = await this.ai.models.generateContent({
                model,
                contents: prompt,
                config: {
                    responseModalities: ['TEXT', 'IMAGE'],
                },
            });
            if (!response.candidates?.[0]?.content?.parts) {
                const reason = response.candidates?.[0]?.finishReason || 'unknown';
                logger.warn('Image generation returned no parts', { finishReason: reason });
                throw new Error(`No image parts (finishReason: ${reason})`);
            }
            let imageBuffer = null;
            let text;
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData?.data) {
                    imageBuffer = Buffer.from(part.inlineData.data, 'base64');
                }
                else if (part.text) {
                    text = part.text;
                }
            }
            if (!imageBuffer) {
                logger.warn('Image generation returned no image data', { textContent: text?.substring(0, 200) });
                throw new Error(`No image data returned. AI said: ${text?.substring(0, 150) || 'nothing'}`);
            }
            return { image: imageBuffer, text };
        }
        catch (error) {
            logger.error('Gemini image generation error:', error);
            throw error;
        }
    }
    async generateSpeech(text) {
        try {
            logger.info(`Generating speech (${text.length} chars)`);
            const response = await this.ai.models.generateContent({
                model: 'gemini-2.5-flash-preview-tts',
                contents: text,
                config: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: 'Kore',
                            },
                        },
                    },
                },
            });
            const audioPart = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
            if (!audioPart?.inlineData?.data) {
                throw new Error('No audio data in TTS response');
            }
            const pcmBuffer = Buffer.from(audioPart.inlineData.data, 'base64');
            logger.info(`TTS returned ${pcmBuffer.length} bytes PCM`);
            return this.convertPcmToOgg(pcmBuffer);
        }
        catch (error) {
            logger.error('Gemini TTS error:', error);
            throw error;
        }
    }
    convertPcmToOgg(pcmBuffer) {
        const ts = Date.now();
        const tmpPcm = join(tmpdir(), `bayles-${ts}.pcm`);
        const tmpOgg = join(tmpdir(), `bayles-${ts}.ogg`);
        try {
            writeFileSync(tmpPcm, pcmBuffer);
            const result = spawnSync('ffmpeg', [
                '-f', 's16le',
                '-ar', '24000',
                '-ac', '1',
                '-i', tmpPcm,
                '-c:a', 'libopus',
                '-b:a', '64k',
                '-y',
                tmpOgg,
            ], { timeout: 30_000 });
            if (result.error) {
                throw new Error(`ffmpeg not found or failed to spawn: ${result.error.message}. Install with: sudo apt install ffmpeg`);
            }
            if (result.status !== 0) {
                const stderr = result.stderr?.toString() || 'unknown error';
                throw new Error(`ffmpeg failed (status ${result.status}): ${stderr.slice(-200)}`);
            }
            const oggBuffer = readFileSync(tmpOgg);
            logger.info(`Converted PCM to OGG: ${oggBuffer.length} bytes`);
            return oggBuffer;
        }
        finally {
            try {
                unlinkSync(tmpPcm);
            }
            catch { /* ignore */ }
            try {
                unlinkSync(tmpOgg);
            }
            catch { /* ignore */ }
        }
    }
    /**
     * Generate content for scheduled messages - NO function calling
     * This prevents AI from re-interpreting prompts as scheduling requests
     */
    async generateScheduledContent(prompt) {
        try {
            const response = await this.ai.models.generateContent({
                model: config.geminiModel,
                contents: prompt,
                config: {
                // NO tools - no function calling, no google search
                // Just pure content generation
                },
            });
            return response.text || 'לא הצלחתי ליצור תוכן.';
        }
        catch (error) {
            logger.error('Gemini scheduled content error:', error);
            throw error;
        }
    }
    /**
     * Parse a Hebrew/English date+time phrase into structured ISO date/times.
     * `mode = 'range'` returns a startDate..endDate (whole-day range).
     * `mode = 'point'` returns startDateTime + endDateTime (with duration).
     */
    async parseDateTimePhrase(opts) {
        const { mode, datePhrase, timePhrase, durationPhrase, todayIso, timezone } = opts;
        const prompt = `You parse a Hebrew/English natural-language date phrase into ISO date strings.

Today is: ${todayIso}
Timezone: ${timezone}
Mode: ${mode === 'range' ? 'date RANGE for listing events' : 'specific time POINT for an event'}

Phrases:
- date_phrase: "${datePhrase || ''}"
${mode === 'point' ? `- time_phrase: "${timePhrase || ''}"\n- duration_phrase: "${durationPhrase || ''}" (default: 60 minutes)` : ''}

Rules:
- "היום" / "today" → today's date.
- "מחר" / "tomorrow" → tomorrow.
- "השבוע" / "this week" → today through Saturday (Israeli week ends Saturday).
- "השבוע הבא" / "next week" → next Sunday through following Saturday.
- "החודש" / "this month" → today through end of month.
- Specific dates ("ב-15 לחודש", "April 20") → resolve to YYYY-MM-DD using current year unless stated.
- Time phrases like "ב21:30", "21:30", "ב9 בבוקר", "10 בבוקר" → 24h time.
- "9 בערב" / "9pm" → 21:00. "9 בבוקר" / "9am" → 09:00.
- If date_phrase is empty for a 'point' mode, assume today.
- If time_phrase is empty for 'point', assume 09:00 and add a note.
- Duration: "שעה" → 60, "30 דקות" → 30, "שעתיים" → 120.

For RANGE mode return startIso (start of first day, YYYY-MM-DDT00:00:00) and endIso (start of day AFTER last day).
For POINT mode return startIso (event start, full ISO with offset omitted — caller adds tz) and endIso (event end).

Return JSON: { startIso, endIso, note }. Note is a one-line warning if you had to guess (e.g., "no time given, assumed 09:00"); empty string otherwise.`;
        const response = await this.ai.models.generateContent({
            model: config.geminiModel,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        startIso: { type: Type.STRING, description: 'Start ISO timestamp.' },
                        endIso: { type: Type.STRING, description: 'End ISO timestamp.' },
                        note: { type: Type.STRING, description: 'Optional one-line warning, or empty string.' },
                    },
                    required: ['startIso', 'endIso', 'note'],
                },
                temperature: 0,
            },
        });
        const parsed = JSON.parse(response.text?.trim() || '{}');
        return {
            startIso: (parsed.startIso || '').trim(),
            endIso: (parsed.endIso || '').trim(),
            note: parsed.note?.trim() || undefined,
        };
    }
    /**
     * Resolve a free-form recipient hint ("אסתר", "ליתי קופרס", "esther@...") to an email.
     * Uses the owner's core memory + people notes. Returns null if unknown.
     */
    async resolveEmailRecipient(hint) {
        if (!hint)
            return { email: null, label: null };
        const trimmed = hint.trim();
        const emailRegex = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
        const angleMatch = trimmed.match(/<([^>]+@[^>]+)>/);
        if (angleMatch)
            return { email: angleMatch[1], label: trimmed.replace(/\s*<[^>]+>/, '').trim() || null };
        if (emailRegex.test(trimmed))
            return { email: trimmed, label: null };
        const memory = getMemoryService();
        let context = '';
        try {
            const core = await memory.readCore();
            context += `CORE:\n${core}\n\n`;
            const people = await memory.listPeople();
            for (const slug of people.slice(0, 40)) {
                const body = await memory.readPerson(slug);
                if (body)
                    context += `PERSON ${slug}:\n${body.slice(0, 600)}\n\n`;
            }
        }
        catch (err) {
            logger.warn('[recipient] memory read failed:', err);
        }
        const prompt = `You resolve a recipient for an email draft in a Hebrew personal-assistant bot.

Owner memory (core + people notes):
"""
${context || '(no memory available)'}
"""

Recipient hint from the user: "${trimmed}"

Return JSON with fields:
- email: the best matching email address, or empty string if none found.
- label: the recipient's display name (Hebrew or English as it appears in memory), or empty string.

Rules:
- Only return an email that literally appears in the memory above. Do NOT invent addresses.
- If the hint is ambiguous or unknown, return empty strings.
- Match on first name, nickname, full name, or role.`;
        try {
            const response = await this.ai.models.generateContent({
                model: config.geminiModel,
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            email: { type: Type.STRING, description: 'Resolved email or empty string.' },
                            label: { type: Type.STRING, description: 'Display name or empty string.' },
                        },
                        required: ['email', 'label'],
                    },
                    temperature: 0,
                },
            });
            const parsed = JSON.parse(response.text?.trim() || '{}');
            const email = (parsed.email || '').trim();
            const label = (parsed.label || '').trim();
            return {
                email: email && emailRegex.test(email) ? email : null,
                label: label || null,
            };
        }
        catch (err) {
            logger.warn('[recipient] resolve failed:', err);
            return { email: null, label: null };
        }
    }
    /**
     * Generate the subject + body for a new email draft. Single focused LLM call,
     * structured output. No tool calling — the workflow owns the sequence.
     */
    async generateEmailBody(opts) {
        const { topicHint, subjectHint, recipientLabel, recipientEmail, priorThreadSnippets, ownerCoreMemory } = opts;
        const thread = priorThreadSnippets?.length
            ? `Prior thread context (most recent first):\n${priorThreadSnippets.slice(0, 3).map((s, i) => `[${i + 1}] ${s}`).join('\n\n')}`
            : '(no prior thread)';
        const prompt = `You are Itai's senior executive-assistant-level email drafter. You write emails that go out to real recipients with real consequences. A poorly drafted email costs Itai time (he has to rewrite it) or credibility (if he sends it as-is). Invest real effort.

Who you are drafting as: Itai, the owner. First person. Never refer to yourself as an assistant or AI.

Recipient: ${recipientLabel || recipientEmail} <${recipientEmail}>
User's brief (what the email should accomplish): ${topicHint || '(none — infer from subject)'}
${subjectHint ? `Subject hint: ${subjectHint}` : ''}

${thread}

Owner core memory (facts about Itai — use to ground the email, don't regurgitate):
"""
${ownerCoreMemory || '(none)'}
"""

## CRITICAL: the brief is NOT the body

The user's brief above is **a short instruction to YOU**, not email content. Your job is to EXPAND it into a proper email. Never paste the brief verbatim, never write a one-line email that just restates the brief. If the brief says "המייל על זה שהעסקה הושלמה בהצלחה", do NOT write "העסקה הושלמה בהצלחה" and sign off — WRITE A FULL EMAIL about the deal closing: what closed, what the path was, what's next.

## Language policy — default ENGLISH

**Default: English, professional business tone.** This applies to work, deals, partnerships, vendors, recruiters, investors, clients, follow-ups, intros, and anything transactional — which is 95% of Itai's email.

**Switch to Hebrew ONLY if:**
- The brief explicitly says "בעברית" / "in Hebrew".
- The email is personal/creative to a family member or friend (love letter, poem, ברכה, family update).
- The recipient's name/domain clearly indicates a Hebrew-only speaker (rare).

**The brief being written in Hebrew is NOT a reason to write the email in Hebrew.** The user speaks Hebrew — their instructions to you are always in Hebrew. That tells you nothing about what language the recipient expects.

If the brief contains conflicting signals, default to English.

## Business-email quality bar (when writing in English)

**Length:** a real business email that accomplishes something is almost never under 80 words. Aim for **4–10 sentences across 2–3 short paragraphs**. A bare "the deal closed, thanks" is not an email — it's a Slack message. If the only thing to say is a one-liner, you're drafting the wrong email.

**Structure:**
1. **Opening (1 sentence):** lead with the point. Why you're writing, what happened, what changed.
2. **Body (2–5 sentences, 1–2 paragraphs):** the substance. Concrete facts. What closed / what you're proposing / what you need. Use specifics from the user's brief — names, deal names, dates, amounts, due-diligence milestones — and expand on them naturally.
3. **Close (1–2 sentences):** a clear next step. "Happy to jump on a call." / "Let me know if you'd like the signed docs." / "Available Thu or Fri for a call." Never end vaguely.

**Voice:** confident, direct, no filler. Kill: "I hope this email finds you well", "I was wondering if", "Just checking in to see if". Keep: plain statements, active voice.

**Subject line:** concrete and scannable — "MEVYX acquisition closed — next steps", "Mibex deal — DD complete, ready to sign", "Intro: Dana ↔ Itai". Never "Hi", "Question", "Update", or a generic phrase.

**Signoff:** "Best," or "Thanks," on one line, then "Itai" on the next. No brackets, no placeholders.

## Hebrew quality bar (when Hebrew is warranted)

- Same structural expectations: opening, substance, close.
- Natural Hebrew prose, not translated English.
- 4+ sentences minimum for anything non-trivial.
- Signoff: "בברכה," / "תודה," + "איתי" on the next line.

## Creative / personal asks

If the brief is a creative request ("שיר אהבה", "ברכה ליום הולדת", "a heartfelt note"), write the creative content AS the body. Don't preface with "Here's the poem you asked for". The body IS the content. Creative asks follow the language of the recipient, not the default-English rule.

## Using prior-thread context

If prior thread context is shown above, use it to calibrate tone and reference shared context — but do NOT quote it or say "as discussed" unless it genuinely adds value. The recipient knows the history.

## Output constraints

- Return subject + body only. No To/From/CC headers.
- Body must be **ready to send**. No TODO markers, no "[insert X]", no "[your name]" placeholders.
- Never echo the user's brief back as the body.
- Do NOT include a preamble like "Here's the draft:" — just the email.

Return JSON with fields:
- subject: the email subject line.
- body: the full email body, ready to send, including the greeting and signoff. Minimum 80 words for English business; minimum 40 words for Hebrew non-trivial.`;
        const response = await this.ai.models.generateContent({
            model: config.geminiModel,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        subject: { type: Type.STRING, description: 'Email subject line.' },
                        body: { type: Type.STRING, description: 'Full email body, ready to send.' },
                    },
                    required: ['subject', 'body'],
                },
                temperature: 0.7,
            },
        });
        const parsed = JSON.parse(response.text?.trim() || '{}');
        return {
            subject: (parsed.subject || subjectHint || 'ללא נושא').trim(),
            body: (parsed.body || '').trim(),
        };
    }
    /**
     * Extract persistent facts about the user from a conversation exchange.
     * Runs asynchronously after sending the AI response - does not block.
     */
    async extractUserFacts(senderJid, userMessage, botResponse, tenantId = 'default') {
        try {
            const memoryRepo = getUserMemoryRepository();
            const existingFacts = memoryRepo.getByJid(senderJid, tenantId);
            const existingList = existingFacts.map(f => f.fact).join('\n');
            const prompt = `You analyze conversations and extract persistent personal facts about the user.

Existing facts about this user:
${existingList || '(none yet)'}

Latest exchange:
User: ${userMessage}
Bot: ${botResponse}

Instructions:
- Extract ONLY persistent personal facts (name, location, family, job, hobbies, preferences, etc.)
- Ignore: temporary states ("I'm tired"), questions, greetings, opinions about current events
- If a new fact UPDATES an existing one (e.g., moved cities), return it as an update
- Return ONLY a JSON array. Each item: {"action":"add"|"update","fact":"...","update_id":number|null}
- update_id is the ID of the existing fact to replace (from the list above), null for new facts
- If there are NO new facts to extract, return an empty array: []
- Keep facts concise (one short sentence each)
- Write facts in the SAME LANGUAGE the user used

Respond with ONLY the JSON array, nothing else.`;
            const response = await this.ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });
            const text = response.text?.trim();
            if (!text || text === '[]')
                return;
            // Parse JSON from response
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (!jsonMatch)
                return;
            const facts = JSON.parse(jsonMatch[0]);
            for (const item of facts) {
                if (!item.fact || item.fact.length < 3)
                    continue;
                if (item.action === 'update' && item.update_id) {
                    memoryRepo.update(item.update_id, item.fact);
                    logger.info(`[memory] Updated fact #${item.update_id} for ${senderJid}: ${item.fact}`);
                }
                else {
                    memoryRepo.create(senderJid, item.fact, 'personal', tenantId);
                    logger.info(`[memory] New fact for ${senderJid}: ${item.fact}`);
                }
            }
        }
        catch (error) {
            logger.warn('[memory] Extraction failed:', error);
        }
    }
    /**
     * Lazy-load conversation history from DB on first access for a JID.
     * Converts DB rows into the ChatHistory format used by the in-memory cache.
     */
    loadHistoryFromDb(historyKey, jid, tenantId) {
        const convRepo = getConversationHistoryRepository();
        const dbMessages = convRepo.getRecent(jid, tenantId, this.maxHistoryLength);
        const history = dbMessages.map(msg => ({
            role: msg.role,
            parts: [{ text: msg.content }],
        }));
        this.conversationHistory.set(historyKey, history);
        if (history.length > 0) {
            logger.info(`Loaded ${history.length} messages from DB for ${historyKey}`);
        }
        return history;
    }
    /**
     * Add a user message + bot action summary to conversation history.
     * Used after function calls (send_message, create_schedule, etc.) so the bot
     * remembers what it did when the user asks later.
     */
    addToHistory(jid, userMessage, actionSummary, tenantId = 'default') {
        const historyKey = `${tenantId}:${jid}`;
        const history = this.conversationHistory.get(historyKey) ?? this.loadHistoryFromDb(historyKey, jid, tenantId);
        history.push({ role: 'user', parts: [{ text: userMessage }] }, { role: 'model', parts: [{ text: actionSummary }] });
        while (history.length > this.maxHistoryLength * 2) {
            history.shift();
        }
        this.conversationHistory.set(historyKey, history);
        getConversationHistoryRepository().addExchange(jid, userMessage, actionSummary, tenantId);
    }
    clearHistory(jid, tenantId = 'default') {
        const historyKey = `${tenantId}:${jid}`;
        this.conversationHistory.delete(historyKey);
        logger.info(`Cleared conversation history for ${historyKey}`);
    }
    clearAllHistory() {
        this.conversationHistory.clear();
        logger.info('Cleared all conversation history');
    }
    listConversations() {
        return Array.from(this.conversationHistory.entries()).map(([jid, history]) => ({
            jid,
            messageCount: history.length,
        }));
    }
}
