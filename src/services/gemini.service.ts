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
