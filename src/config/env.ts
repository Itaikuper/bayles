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

  // Google Calendar
  googleServiceAccountPath: process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './service-account.json',
  calendarDailySummaryCron: process.env.CALENDAR_DAILY_SUMMARY_CRON || '0 7 * * *',
  calendarTimezone: process.env.CALENDAR_TIMEZONE || 'Asia/Jerusalem',

  // Gmail personal assistant (private; single owner JID)
  gmailClientId: process.env.GMAIL_CLIENT_ID || '',
  gmailClientSecret: process.env.GMAIL_CLIENT_SECRET || '',
  gmailRedirectUri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/api/gmail/oauth/callback',
  gmailOwnerJid: process.env.GMAIL_OWNER_JID || '',
  gmailEncryptionKey: process.env.GMAIL_ENCRYPTION_KEY || '',
  gmailPollCron: process.env.GMAIL_POLL_CRON || '*/7 * * * *',
};

export function isGmailEnabled(): boolean {
  return Boolean(
    config.gmailClientId &&
    config.gmailClientSecret &&
    config.gmailOwnerJid &&
    config.gmailEncryptionKey
  );
}

export function validateConfig(): void {
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is required. Please set it in .env file.');
  }
  if (isGmailEnabled()) {
    // base64-encoded 32 bytes
    try {
      const raw = Buffer.from(config.gmailEncryptionKey, 'base64');
      if (raw.length !== 32) {
        throw new Error('GMAIL_ENCRYPTION_KEY must decode to exactly 32 bytes (base64). Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('GMAIL_ENCRYPTION_KEY')) throw err;
      throw new Error('GMAIL_ENCRYPTION_KEY must be valid base64.');
    }
  }
}
