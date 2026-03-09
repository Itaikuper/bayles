import { GoogleGenAI, Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getKnowledgeRepository } from '../database/repositories/knowledge.repository.js';
import { getUserMemoryRepository } from '../database/repositories/user-memory.repository.js';
import { getConversationHistoryRepository } from '../database/repositories/conversation-history.repository.js';
import type { ChatHistory, GeminiResponse } from '../types/index.js';

// Function declaration for natural language scheduling
const createScheduleDeclaration: FunctionDeclaration = {
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
const searchSongDeclaration: FunctionDeclaration = {
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
const searchContactDeclaration: FunctionDeclaration = {
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
const searchHoshayaDirectoryDeclaration: FunctionDeclaration = {
  name: 'search_hoshaya_directory',
  description: 'Search the Hoshaya village phone directory for a resident by name. Use when user asks for a phone number of someone in Hoshaya, or asks to find a resident. Keywords: טלפון בהושעיה, מספר של, תושב הושעיה, ספר טלפונים הושעיה, מי גר ב.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'Name to search for (first name, last name, or both). Examples: "כהן", "דוד כהן", "משה"',
      },
    },
    required: ['query'],
  },
};

// Function declaration for sending messages to other people/groups
const sendMessageDeclaration: FunctionDeclaration = {
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
const listCalendarEventsDeclaration: FunctionDeclaration = {
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

const createCalendarEventDeclaration: FunctionDeclaration = {
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

const updateCalendarEventDeclaration: FunctionDeclaration = {
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

const deleteCalendarEventDeclaration: FunctionDeclaration = {
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

export class GeminiService {
  private ai: GoogleGenAI;
  private conversationHistory: Map<string, ChatHistory[]> = new Map();
  private maxHistoryLength = 20; // Keep last 20 message pairs per conversation

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }

  private getImageInstructions(): string {
    if (!config.autoImageGeneration) return '';
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

  async generateResponse(jid: string, userMessage: string, customPrompt?: string, tenantId: string = 'default', senderJid?: string): Promise<GeminiResponse> {
    try {
      // Get or initialize conversation history (scoped by tenant)
      const historyKey = `${tenantId}:${jid}`;
      const history = this.conversationHistory.get(historyKey) ?? this.loadHistoryFromDb(historyKey, jid, tenantId);

      // Get knowledge base for this chat
      const knowledgeRepo = getKnowledgeRepository();
      const knowledgeContext = knowledgeRepo.getFormattedKnowledge(jid);

      // Get user memories for the sender (not the group JID)
      const memoryRepo = getUserMemoryRepository();
      const userMemories = memoryRepo.getFormattedMemories(senderJid || jid, tenantId);

      // Get conversation summaries from compaction
      const convRepo = getConversationHistoryRepository();
      const summaries = convRepo.getFormattedSummaries(jid, tenantId);

      // Use custom prompt if provided, otherwise use default, plus knowledge + memories + summaries
      const systemPrompt = (customPrompt || config.systemPrompt) + knowledgeContext + userMemories + summaries + this.getImageInstructions();

      // Get today's date for scheduling context
      const today = new Date();
      const dateContext = `Today is ${today.toISOString().split('T')[0]} (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][today.getDay()]}).`;

      // Capability context so the model knows what it can do and trusts action records
      const capabilityContext = `
You have real capabilities through function calling: send messages to other people (send_message), schedule messages (create_schedule), search songs (search_song), search contacts (search_contact), search Hoshaya village phone directory (search_hoshaya_directory), and manage calendar events.
Messages in [brackets] in conversation history are factual records of actions you performed. Trust them completely — if it says [שלחתי הודעה ל...], you DID send that message. Never deny or contradict these records.`;

      // Only enable function calling when message matches known patterns
      // Otherwise use googleSearch for regular queries (weather, current events, etc.)
      // Note: googleSearch and functionDeclarations DON'T work together (known SDK bug)
      const schedulingKeywords = /תזמן|תזכיר|תשלח בשעה|כל יום|מחר בשעה|schedule|remind|תקבע|הזכר לי|בשעה \d/i;
      const songKeywords = /שיר|אקורד|טאב|גיטרה|chord|song|tab|לנגן|תנגן|אקורד/i;
      const contactKeywords = /טלפון|פלאפון|מספר של|איש קשר|phone|contact|number/i;
      const hoshayaDirectoryKeywords = /הושעיה|טלפון של|מספר של|ספר טלפונים|מי גר ב|תושב|טלפון|פלאפון|מספר של|איש קשר|phone|contact|number/i;
      const calendarKeywords = /מה יש לי|יומן|אירוע|פגישה|לוח|לוז|תוסיף אירוע|תקבע פגישה|תכניס ליומן|תמחק אירוע|תבטל פגישה|תשנה אירוע|תזיז|תעדכן אירוע|calendar|events|meeting|schedule|agenda/i;
      const sendMessageKeywords = /תשלח ל|שלח ל|שלח .{1,30} ל|לשלוח ל|לשלוח .{1,30} ל|לשלוח הודעה|תגיד ל|תודיע ל|תעביר ל|הודעה ל|send to|send .{1,30} to|tell .+ that|forward to|למספר \d/i;
      const isSchedulingRequest = schedulingKeywords.test(userMessage);
      const isSongRequest = songKeywords.test(userMessage);
      const isContactRequest = contactKeywords.test(userMessage);
      const isHoshayaDirectoryRequest = hoshayaDirectoryKeywords.test(userMessage);
      const isCalendarRequest = calendarKeywords.test(userMessage);
      const isSendMessageRequest = sendMessageKeywords.test(userMessage);
      // Also check if recent history has a hoshaya directory search (for follow-up queries like just a name)
      const toolHistoryKey = `${tenantId}:${jid}`;
      const recentHistory = this.conversationHistory.get(toolHistoryKey) ?? [];
      const hasRecentDirectorySearch = recentHistory.slice(-4).some(m =>
        m.role === 'model' && m.parts?.some(p => (p as { text?: string }).text?.includes('חיפשתי בספר הטלפונים של הושעיה'))
      );
      const isFunctionCallRequest = isSchedulingRequest || isSongRequest || isContactRequest || isHoshayaDirectoryRequest || isCalendarRequest || isSendMessageRequest || hasRecentDirectorySearch;

      const functionDeclarations: FunctionDeclaration[] = [];
      if (isSchedulingRequest) functionDeclarations.push(createScheduleDeclaration);
      if (isSongRequest) functionDeclarations.push(searchSongDeclaration);
      if (isContactRequest) functionDeclarations.push(searchContactDeclaration);
      if (isHoshayaDirectoryRequest || hasRecentDirectorySearch) functionDeclarations.push(searchHoshayaDirectoryDeclaration);
      if (isCalendarRequest) {
        functionDeclarations.push(
          listCalendarEventsDeclaration,
          createCalendarEventDeclaration,
          updateCalendarEventDeclaration,
          deleteCalendarEventDeclaration
        );
      }
      if (isSendMessageRequest) functionDeclarations.push(sendMessageDeclaration);

      const tools = isFunctionCallRequest
        ? [{ functionDeclarations }]
        : [{ googleSearch: {} }];

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
              args: (functionCall.args || {}) as Record<string, unknown>,
            },
          };
        }
      }

      const responseText =
        response.text || 'Sorry, I could not generate a response.';

      // Update history
      history.push(
        { role: 'user', parts: [{ text: userMessage }] },
        { role: 'model', parts: [{ text: responseText }] }
      );

      // Trim history if too long
      while (history.length > this.maxHistoryLength * 2) {
        history.shift();
      }

      this.conversationHistory.set(historyKey, history);

      // Persist to DB
      getConversationHistoryRepository().addExchange(jid, userMessage, responseText, tenantId);

      return { type: 'text', text: responseText };
    } catch (error) {
      logger.error('Gemini API error:', error);
      return { type: 'text', text: 'Sorry, I encountered an error processing your request.' };
    }
  }

  async generateAudioResponse(
    jid: string,
    audioBuffer: Buffer,
    mimeType: string,
    customPrompt?: string,
    contextPrefix?: string,
    tenantId: string = 'default',
    senderJid?: string
  ): Promise<string> {
    try {
      const historyKey = `${tenantId}:${jid}`;
      const history = this.conversationHistory.get(historyKey) ?? this.loadHistoryFromDb(historyKey, jid, tenantId);
      const knowledgeRepo = getKnowledgeRepository();
      const knowledgeContext = knowledgeRepo.getFormattedKnowledge(jid);

      // Load user memories for the sender
      const memoryRepo = getUserMemoryRepository();
      const userMemories = memoryRepo.getFormattedMemories(senderJid || jid, tenantId);

      // Get conversation summaries from compaction
      const convRepo = getConversationHistoryRepository();
      const summaries = convRepo.getFormattedSummaries(jid, tenantId);

      const systemPrompt = (customPrompt || config.systemPrompt) + knowledgeContext + userMemories + summaries + this.getImageInstructions();

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
      history.push(
        { role: 'user', parts: [{ text: historyLabel }] },
        { role: 'model', parts: [{ text: responseText }] }
      );

      while (history.length > this.maxHistoryLength * 2) {
        history.shift();
      }

      this.conversationHistory.set(historyKey, history);

      // Persist to DB
      convRepo.addExchange(jid, historyLabel, responseText, tenantId);

      return responseText;
    } catch (error) {
      logger.error('Gemini audio API error:', error);
      return 'Sorry, I encountered an error processing the voice message.';
    }
  }

  async transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
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
    } catch (error) {
      logger.error('Gemini transcription error:', error);
      return 'שגיאה בתמלול ההקלטה. נסה שוב.';
    }
  }

  async generateDocumentAnalysisResponse(
    jid: string,
    mediaBuffer: Buffer,
    mimeType: string,
    caption?: string,
    customPrompt?: string,
    contextPrefix?: string,
    fileName?: string,
    tenantId: string = 'default'
  ): Promise<string> {
    try {
      const historyKey = `${tenantId}:${jid}`;
      const history = this.conversationHistory.get(historyKey) ?? this.loadHistoryFromDb(historyKey, jid, tenantId);
      const knowledgeRepo = getKnowledgeRepository();
      const knowledgeContext = knowledgeRepo.getFormattedKnowledge(jid);

      // Get conversation summaries from compaction
      const convRepo = getConversationHistoryRepository();
      const summaries = convRepo.getFormattedSummaries(jid, tenantId);

      const systemPrompt = (customPrompt || config.systemPrompt) + knowledgeContext + summaries + this.getImageInstructions();

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
      let textPrompt: string;
      if (caption) {
        const prefix = contextPrefix ? `${contextPrefix} ` : '';
        textPrompt = `${prefix}המשתמש שלח תמונה/מסמך${fileName ? ` (${fileName})` : ''} עם ההוראה: "${caption}". נתח את התוכן ובצע את מה שהמשתמש מבקש.`;
      } else {
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
      history.push(
        { role: 'user', parts: [{ text: historyText }] },
        { role: 'model', parts: [{ text: responseText }] }
      );

      while (history.length > this.maxHistoryLength * 2) {
        history.shift();
      }

      this.conversationHistory.set(historyKey, history);

      // Persist to DB
      getConversationHistoryRepository().addExchange(jid, historyText, responseText, tenantId);

      return responseText;
    } catch (error) {
      logger.error('Gemini document analysis error:', error);
      return 'סליחה, לא הצלחתי לנתח את המסמך. נסה שוב.';
    }
  }

  async generateImage(prompt: string, pro = false): Promise<{ image: Buffer; text?: string } | null> {
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

      let imageBuffer: Buffer | null = null;
      let text: string | undefined;

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData?.data) {
          imageBuffer = Buffer.from(part.inlineData.data, 'base64');
        } else if (part.text) {
          text = part.text;
        }
      }

      if (!imageBuffer) {
        logger.warn('Image generation returned no image data', { textContent: text?.substring(0, 200) });
        throw new Error(`No image data returned. AI said: ${text?.substring(0, 150) || 'nothing'}`);
      }

      return { image: imageBuffer, text };
    } catch (error) {
      logger.error('Gemini image generation error:', error);
      throw error;
    }
  }

  async generateSpeech(text: string): Promise<Buffer> {
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

      const audioPart = response.candidates?.[0]?.content?.parts?.find(
        (p: any) => p.inlineData?.data
      );
      if (!audioPart?.inlineData?.data) {
        throw new Error('No audio data in TTS response');
      }

      const pcmBuffer = Buffer.from(audioPart.inlineData.data, 'base64');
      logger.info(`TTS returned ${pcmBuffer.length} bytes PCM`);

      return this.convertPcmToOgg(pcmBuffer);
    } catch (error) {
      logger.error('Gemini TTS error:', error);
      throw error;
    }
  }

  private convertPcmToOgg(pcmBuffer: Buffer): Buffer {
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
    } finally {
      try { unlinkSync(tmpPcm); } catch { /* ignore */ }
      try { unlinkSync(tmpOgg); } catch { /* ignore */ }
    }
  }

  /**
   * Generate content for scheduled messages - NO function calling
   * This prevents AI from re-interpreting prompts as scheduling requests
   */
  async generateScheduledContent(prompt: string): Promise<string> {
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
    } catch (error) {
      logger.error('Gemini scheduled content error:', error);
      throw error;
    }
  }

  /**
   * Extract persistent facts about the user from a conversation exchange.
   * Runs asynchronously after sending the AI response - does not block.
   */
  async extractUserFacts(
    senderJid: string,
    userMessage: string,
    botResponse: string,
    tenantId: string = 'default'
  ): Promise<void> {
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
      if (!text || text === '[]') return;

      // Parse JSON from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return;

      const facts = JSON.parse(jsonMatch[0]) as Array<{
        action: 'add' | 'update';
        fact: string;
        update_id: number | null;
      }>;

      for (const item of facts) {
        if (!item.fact || item.fact.length < 3) continue;

        if (item.action === 'update' && item.update_id) {
          memoryRepo.update(item.update_id, item.fact);
          logger.info(`[memory] Updated fact #${item.update_id} for ${senderJid}: ${item.fact}`);
        } else {
          memoryRepo.create(senderJid, item.fact, 'personal', tenantId);
          logger.info(`[memory] New fact for ${senderJid}: ${item.fact}`);
        }
      }
    } catch (error) {
      logger.warn('[memory] Extraction failed:', error);
    }
  }

  /**
   * Lazy-load conversation history from DB on first access for a JID.
   * Converts DB rows into the ChatHistory format used by the in-memory cache.
   */
  private loadHistoryFromDb(historyKey: string, jid: string, tenantId: string): ChatHistory[] {
    const convRepo = getConversationHistoryRepository();
    const dbMessages = convRepo.getRecent(jid, tenantId, this.maxHistoryLength);

    const history: ChatHistory[] = dbMessages.map(msg => ({
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
  addToHistory(jid: string, userMessage: string, actionSummary: string, tenantId: string = 'default'): void {
    const historyKey = `${tenantId}:${jid}`;
    const history = this.conversationHistory.get(historyKey) ?? this.loadHistoryFromDb(historyKey, jid, tenantId);

    history.push(
      { role: 'user', parts: [{ text: userMessage }] },
      { role: 'model', parts: [{ text: actionSummary }] }
    );

    while (history.length > this.maxHistoryLength * 2) {
      history.shift();
    }

    this.conversationHistory.set(historyKey, history);
    getConversationHistoryRepository().addExchange(jid, userMessage, actionSummary, tenantId);
  }

  clearHistory(jid: string, tenantId: string = 'default'): void {
    const historyKey = `${tenantId}:${jid}`;
    this.conversationHistory.delete(historyKey);
    logger.info(`Cleared conversation history for ${historyKey}`);
  }

  clearAllHistory(): void {
    this.conversationHistory.clear();
    logger.info('Cleared all conversation history');
  }

  listConversations(): { jid: string; messageCount: number }[] {
    return Array.from(this.conversationHistory.entries()).map(([jid, history]) => ({
      jid,
      messageCount: history.length,
    }));
  }
}
