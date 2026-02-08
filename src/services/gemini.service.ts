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
      const history = this.conversationHistory.get(historyKey) || [];

      // Get knowledge base for this chat
      const knowledgeRepo = getKnowledgeRepository();
      const knowledgeContext = knowledgeRepo.getFormattedKnowledge(jid);

      // Get user memories for the sender (not the group JID)
      const memoryRepo = getUserMemoryRepository();
      const userMemories = memoryRepo.getFormattedMemories(senderJid || jid, tenantId);

      // Use custom prompt if provided, otherwise use default, plus knowledge + memories
      const systemPrompt = (customPrompt || config.systemPrompt) + knowledgeContext + userMemories + this.getImageInstructions();

      // Get today's date for scheduling context
      const today = new Date();
      const dateContext = `Today is ${today.toISOString().split('T')[0]} (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][today.getDay()]}).`;

      // Only enable function calling when message matches known patterns
      // Otherwise use googleSearch for regular queries (weather, current events, etc.)
      // Note: googleSearch and functionDeclarations DON'T work together (known SDK bug)
      const schedulingKeywords = /תזמן|תזכיר|תשלח בשעה|כל יום|מחר בשעה|schedule|remind|תקבע|הזכר לי|בשעה \d/i;
      const songKeywords = /שיר|אקורד|טאב|גיטרה|chord|song|tab|לנגן|תנגן|אקורד/i;
      const contactKeywords = /טלפון|פלאפון|מספר של|איש קשר|phone|contact|number/i;
      const isSchedulingRequest = schedulingKeywords.test(userMessage);
      const isSongRequest = songKeywords.test(userMessage);
      const isContactRequest = contactKeywords.test(userMessage);
      const isFunctionCallRequest = isSchedulingRequest || isSongRequest || isContactRequest;

      const functionDeclarations: FunctionDeclaration[] = [];
      if (isSchedulingRequest) functionDeclarations.push(createScheduleDeclaration);
      if (isSongRequest) functionDeclarations.push(searchSongDeclaration);
      if (isContactRequest) functionDeclarations.push(searchContactDeclaration);

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
            parts: [{ text: `System instruction: ${systemPrompt}\n\n${dateContext}` }],
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
    tenantId: string = 'default'
  ): Promise<string> {
    try {
      const historyKey = `${tenantId}:${jid}`;
      const history = this.conversationHistory.get(historyKey) || [];
      const knowledgeRepo = getKnowledgeRepository();
      const knowledgeContext = knowledgeRepo.getFormattedKnowledge(jid);
      const systemPrompt = (customPrompt || config.systemPrompt) + knowledgeContext + this.getImageInstructions();

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
      const textPrompt = contextPrefix
        ? `${contextPrefix} The user sent a voice message. Listen to it and respond appropriately.`
        : 'The user sent a voice message. Listen to it and respond appropriately.';

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
      return responseText;
    } catch (error) {
      logger.error('Gemini audio API error:', error);
      return 'Sorry, I encountered an error processing the voice message.';
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
      const history = this.conversationHistory.get(historyKey) || [];
      const knowledgeRepo = getKnowledgeRepository();
      const knowledgeContext = knowledgeRepo.getFormattedKnowledge(jid);
      const systemPrompt = (customPrompt || config.systemPrompt) + knowledgeContext + this.getImageInstructions();

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
        model: 'gemini-2.0-flash',
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
