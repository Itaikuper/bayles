import { GoogleGenAI } from '@google/genai';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { ChatHistory } from '../types/index.js';

export class GeminiService {
  private ai: GoogleGenAI;
  private conversationHistory: Map<string, ChatHistory[]> = new Map();
  private maxHistoryLength = 20; // Keep last 20 message pairs per conversation

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }

  async generateResponse(jid: string, userMessage: string, customPrompt?: string): Promise<string> {
    try {
      // Get or initialize conversation history
      const history = this.conversationHistory.get(jid) || [];

      // Use custom prompt if provided, otherwise use default
      const systemPrompt = customPrompt || config.systemPrompt;

      // Create chat with history, system instruction, and Google Search
      const chat = this.ai.chats.create({
        model: config.geminiModel,
        config: {
          tools: [{ googleSearch: {} }], // Enable Google Search for real-time info
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
      const response = await chat.sendMessage({
        message: userMessage,
      });

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
      const systemPrompt = customPrompt || config.systemPrompt;

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
