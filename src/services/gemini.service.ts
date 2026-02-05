import { GoogleGenAI } from '@google/genai';
import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { config } from '../config/env.js';
import { calendarFunctionDeclarations } from '../config/calendar-tools.js';
import { logger } from '../utils/logger.js';
import type { ChatHistory } from '../types/index.js';
import type { CalendarService } from './calendar.service.js';

export class GeminiService {
  private ai: GoogleGenAI;
  private conversationHistory: Map<string, ChatHistory[]> = new Map();
  private maxHistoryLength = 20; // Keep last 20 message pairs per conversation
  private calendarService: CalendarService | null = null;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }

  setCalendarService(service: CalendarService): void {
    this.calendarService = service;
    logger.info('Calendar service connected to Gemini');
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

  private getCalendarInstructions(): string {
    if (!this.calendarService) return '';
    return `

יש לך גישה ליומן Google משפחתי. אתה יכול לנהל אירועים ביומן.

יכולות:
- יצירת אירוע חדש (calendar_create_event)
- הצגת אירועים קרובים (calendar_list_events)
- עדכון אירוע קיים (calendar_update_event) - חייב קודם להציג אירועים כדי לקבל event_id
- מחיקת אירוע (calendar_delete_event) - חייב קודם להציג אירועים כדי לקבל event_id

כללים:
1. התאריך והשעה של היום: ${new Date().toISOString()}. השתמש בזה לחישוב "מחר", "יום שלישי הבא" וכו'.
2. אם המשתמש לא מציין שעת סיום, קבע שעה אחת אחרי ההתחלה.
3. אם המשתמש רוצה לעדכן או למחוק אירוע, קודם הצג את רשימת האירועים כדי למצוא את ה-event_id.
4. תמיד ענה בעברית ואשר את הפעולה שביצעת.
5. כשאתה מציג אירועים, הצג אותם בצורה ברורה עם תאריך, שעה, ומיקום.`;
  }

  private buildTools(): any[] {
    const tools: any[] = [{ googleSearch: {} }];
    if (this.calendarService) {
      tools.push({ functionDeclarations: calendarFunctionDeclarations });
    }
    return tools;
  }

  private async executeFunctionCalls(
    functionCalls: Array<{ name?: string; args?: Record<string, unknown> }>
  ): Promise<any[]> {
    const responses: any[] = [];
    for (const fc of functionCalls) {
      if (!fc.name || !this.calendarService) {
        responses.push({
          functionResponse: {
            name: fc.name || 'unknown',
            response: { error: 'Calendar not available' },
          },
        });
        continue;
      }

      const result = await this.calendarService.executeFunction(fc.name, fc.args || {});
      logger.info(`Function ${fc.name} result: ${JSON.stringify(result).substring(0, 200)}`);

      responses.push({
        functionResponse: {
          name: fc.name,
          response: result,
        },
      });
    }
    return responses;
  }

  async generateResponse(jid: string, userMessage: string, customPrompt?: string): Promise<string> {
    try {
      // Get or initialize conversation history
      const history = this.conversationHistory.get(jid) || [];

      // Use custom prompt if provided, otherwise use default
      const systemPrompt = (customPrompt || config.systemPrompt)
        + this.getImageInstructions()
        + this.getCalendarInstructions();

      // Create chat with history, system instruction, Google Search, and calendar tools
      const chat = this.ai.chats.create({
        model: config.geminiModel,
        config: {
          tools: this.buildTools(),
        },
        history: [
          // Add system instruction as first message pair
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

      // Send message and get response
      let response = await chat.sendMessage({
        message: userMessage,
      });

      // Function calling loop (max 5 iterations)
      let iterations = 0;
      while (response.functionCalls && response.functionCalls.length > 0 && iterations < 5) {
        iterations++;
        logger.info(`Function call iteration ${iterations}: ${response.functionCalls.map(fc => fc.name).join(', ')}`);

        const functionResponseParts = await this.executeFunctionCalls(response.functionCalls);
        response = await chat.sendMessage({ message: functionResponseParts });
      }

      const responseText =
        response.text || 'Sorry, I could not generate a response.';

      // Update history (store only final user message + final text response)
      history.push(
        { role: 'user', parts: [{ text: userMessage }] },
        { role: 'model', parts: [{ text: responseText }] }
      );

      // Trim history if too long
      while (history.length > this.maxHistoryLength * 2) {
        history.shift();
      }

      this.conversationHistory.set(jid, history);

      return responseText;
    } catch (error) {
      logger.error('Gemini API error:', error);
      return 'Sorry, I encountered an error processing your request.';
    }
  }

  async generateAudioResponse(
    jid: string,
    audioBuffer: Buffer,
    mimeType: string,
    customPrompt?: string,
    contextPrefix?: string
  ): Promise<string> {
    try {
      const history = this.conversationHistory.get(jid) || [];
      const systemPrompt = (customPrompt || config.systemPrompt) + this.getImageInstructions();

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

      this.conversationHistory.set(jid, history);
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
    fileName?: string
  ): Promise<string> {
    try {
      const history = this.conversationHistory.get(jid) || [];
      const systemPrompt = (customPrompt || config.systemPrompt) + this.getImageInstructions();

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

      this.conversationHistory.set(jid, history);
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

  clearHistory(jid: string): void {
    this.conversationHistory.delete(jid);
    logger.info(`Cleared conversation history for ${jid}`);
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
