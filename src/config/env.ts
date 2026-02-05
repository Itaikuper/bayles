import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Gemini AI
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',

  // WhatsApp
  authDir: process.env.AUTH_DIR || './auth_info',

  // Bot behavior
  botPrefix: process.env.BOT_PREFIX || '!ai',

  // Family group auto-whitelist
  familyGroupName: process.env.FAMILY_GROUP_NAME || 'משפחה לא בוחרים',

  // System prompt for AI
  systemPrompt:
    process.env.SYSTEM_PROMPT ||
    'You are a helpful WhatsApp assistant. Keep responses concise and conversational. Respond in the same language as the user.',

  // Auto image generation in learning conversations
  autoImageGeneration: process.env.AUTO_IMAGE_GENERATION !== 'false',
};

export function validateConfig(): void {
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is required. Please set it in .env file.');
  }
}
