import { GoogleGenAI, Type } from '@google/genai';
import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
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
                description: 'Message content to send. Extract the actual message from user request.',
            },
            useAi: {
                type: Type.BOOLEAN,
                description: 'true if message is a prompt for AI to generate new content each time (e.g., "תייצר ציטוט", "כתוב בדיחה"). false for fixed messages.',
            },
        },
        required: ['targetName', 'hour', 'minute', 'message', 'useAi'],
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
    async generateResponse(jid, userMessage, customPrompt) {
        try {
            // Get or initialize conversation history
            const history = this.conversationHistory.get(jid) || [];
            // Use custom prompt if provided, otherwise use default
            const systemPrompt = (customPrompt || config.systemPrompt) + this.getImageInstructions();
            // Get today's date for scheduling context
            const today = new Date();
            const dateContext = `Today is ${today.toISOString().split('T')[0]} (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][today.getDay()]}).`;
            // Create chat with history, system instruction, and scheduling function
            // Note: googleSearch and functionDeclarations DON'T work together (known SDK bug)
            // See: https://github.com/google-gemini/deprecated-generative-ai-js/issues/433
            const chat = this.ai.chats.create({
                model: config.geminiModel,
                config: {
                    tools: [{
                            functionDeclarations: [createScheduleDeclaration],
                        }],
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
            this.conversationHistory.set(jid, history);
            return { type: 'text', text: responseText };
        }
        catch (error) {
            logger.error('Gemini API error:', error);
            return { type: 'text', text: 'Sorry, I encountered an error processing your request.' };
        }
    }
    async generateAudioResponse(jid, audioBuffer, mimeType, customPrompt, contextPrefix) {
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
            history.push({ role: 'user', parts: [{ text: historyLabel }] }, { role: 'model', parts: [{ text: responseText }] });
            while (history.length > this.maxHistoryLength * 2) {
                history.shift();
            }
            this.conversationHistory.set(jid, history);
            return responseText;
        }
        catch (error) {
            logger.error('Gemini audio API error:', error);
            return 'Sorry, I encountered an error processing the voice message.';
        }
    }
    async generateDocumentAnalysisResponse(jid, mediaBuffer, mimeType, caption, customPrompt, contextPrefix, fileName) {
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
            this.conversationHistory.set(jid, history);
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
    clearHistory(jid) {
        this.conversationHistory.delete(jid);
        logger.info(`Cleared conversation history for ${jid}`);
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
