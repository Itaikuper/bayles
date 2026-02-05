import { proto } from '@whiskeysockets/baileys';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { GeminiService } from '../services/gemini.service.js';
import { SchedulerService } from '../services/scheduler.service.js';
import { BotControlService } from '../services/bot-control.service.js';
import { BirthdayService } from '../services/birthday.service.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

export class MessageHandler {
  constructor(
    private whatsapp: WhatsAppService,
    private gemini: GeminiService,
    private scheduler: SchedulerService,
    private botControl: BotControlService,
    private birthdayService: BirthdayService
  ) {}

  async handle(message: proto.IWebMessageInfo): Promise<void> {
    const jid = message.key.remoteJid;
    if (!jid) return;

    // Handle voice/audio messages
    const audioMessage = message.message?.audioMessage;
    if (audioMessage) {
      await this.handleAudioMessage(message, jid, audioMessage);
      return;
    }

    const text = this.extractText(message);
    if (!text) return;

    const isGroup = jid.endsWith('@g.us');
    const sender = isGroup ? message.key.participant : jid;

    logger.info(`Message from ${sender} in ${isGroup ? 'group' : 'DM'}: ${text}`);

    // For groups, check if message starts with prefix
    const hasPrefix = text.startsWith(config.botPrefix);

    // Check if the message is a reply to the bot or mentions the bot
    const isReplyToBot = this.isReplyToBotMessage(message);
    const isMentioningBot = this.isMentioningBot(message);

    // Debug logging
    const botJid = this.whatsapp.getBotJid();
    const botLid = this.whatsapp.getBotLid();
    const contextInfo = message.message?.extendedTextMessage?.contextInfo;
    logger.info(`DEBUG - Bot JID: ${botJid}, Bot LID: ${botLid}`);
    logger.info(`DEBUG - Mentioned JIDs: ${JSON.stringify(contextInfo?.mentionedJid)}`);
    logger.info(`DEBUG - isReplyToBot: ${isReplyToBot}, isMentioningBot: ${isMentioningBot}, hasPrefix: ${hasPrefix}`);

    // Remove prefix or bot mention from text
    let cleanText = hasPrefix
      ? text.slice(config.botPrefix.length).trim()
      : text;

    // Strip bot mention (@<jid-number>) from beginning of message in groups
    if (isGroup && isMentioningBot) {
      cleanText = cleanText.replace(/^@\d+\s*/, '').trim();
    }

    // Check if message contains trigger words (פרופסור / בוט)
    const hasTriggerWord = /(?:^|[\s,.!?])(?:פרופסור|בוט)(?:[\s,.!?]|$)/.test(text);

    // For groups: respond only if has prefix OR is a reply to bot OR mentions bot OR has trigger word
    if (isGroup && !hasPrefix && !isReplyToBot && !isMentioningBot && !hasTriggerWord) {
      return;
    }

    // Get decision from bot control service
    const decision = this.botControl.shouldRespondToMessage(jid, isGroup);

    // Log the activity
    this.botControl.logActivity(
      jid,
      sender || undefined,
      cleanText,
      isGroup,
      decision.shouldRespond ?
        (decision.responseType === 'auto_reply' ? 'auto_reply' : 'responded') :
        'ignored',
      decision.reason
    );

    // If we shouldn't respond, stop here
    if (!decision.shouldRespond) {
      logger.info(`Not responding: ${decision.reason}`);
      return;
    }

    // Handle empty message after prefix
    if (!cleanText) {
      await this.whatsapp.sendReply(jid, this.getHelpText(), message);
      return;
    }

    // Handle commands (always process if responding)
    if (cleanText.startsWith('/')) {
      await this.handleCommand(jid, cleanText, message);
      return;
    }

    // Handle based on response type
    if (decision.responseType === 'auto_reply' && decision.autoReplyMessage) {
      // Send configured auto-reply message
      await this.whatsapp.sendReply(jid, decision.autoReplyMessage, message);
      return;
    }

    // Check for image generation request (keyword-based)
    const imagePrompt = this.extractImagePrompt(cleanText);
    if (imagePrompt !== null) {
      await this.handleImageGeneration(jid, imagePrompt, message);
      return;
    }

    // Generate AI response
    try {
      // In groups, include sender's name so the AI knows who's talking
      const messageForAI = isGroup && message.pushName
        ? `[${message.pushName}]: ${cleanText}`
        : cleanText;

      const response = await this.gemini.generateResponse(
        jid,
        messageForAI,
        decision.customPrompt
      );
      await this.whatsapp.sendReply(jid, response, message);
    } catch (error) {
      logger.error('Error generating response:', error);
      await this.whatsapp.sendReply(
        jid,
        'Sorry, something went wrong. Please try again.',
        message
      );
    }
  }

  private extractText(message: proto.IWebMessageInfo): string | null {
    const msg = message.message;
    if (!msg) return null;

    return (
      msg.conversation ||
      msg.extendedTextMessage?.text ||
      msg.imageMessage?.caption ||
      msg.videoMessage?.caption ||
      null
    );
  }

  private async handleAudioMessage(
    message: proto.IWebMessageInfo,
    jid: string,
    audioMessage: proto.Message.IAudioMessage
  ): Promise<void> {
    const isGroup = jid.endsWith('@g.us');
    const sender = isGroup ? message.key.participant : jid;

    logger.info(`Voice message from ${sender} in ${isGroup ? 'group' : 'DM'} (${audioMessage.seconds || '?'}s)`);

    // In groups, voice messages only processed if reply-to-bot
    if (isGroup && !this.isReplyToBotMessage(message)) {
      return;
    }

    const decision = this.botControl.shouldRespondToMessage(jid, isGroup);

    this.botControl.logActivity(
      jid,
      sender || undefined,
      '[הודעה קולית]',
      isGroup,
      decision.shouldRespond ? 'responded' : 'ignored',
      decision.reason
    );

    if (!decision.shouldRespond) {
      logger.info(`Not responding to voice message: ${decision.reason}`);
      return;
    }

    if (decision.responseType === 'auto_reply' && decision.autoReplyMessage) {
      await this.whatsapp.sendReply(jid, decision.autoReplyMessage, message);
      return;
    }

    try {
      const audioBuffer = await this.whatsapp.downloadAudio(audioMessage);
      const mimeType = audioMessage.mimetype || 'audio/ogg; codecs=opus';

      const contextPrefix = isGroup && message.pushName
        ? `[${message.pushName}]`
        : undefined;

      const response = await this.gemini.generateAudioResponse(
        jid,
        audioBuffer,
        mimeType,
        decision.customPrompt,
        contextPrefix
      );
      await this.whatsapp.sendReply(jid, response, message);
    } catch (error) {
      logger.error('Error processing voice message:', error);
      await this.whatsapp.sendReply(
        jid,
        'סליחה, לא הצלחתי לעבד את ההודעה הקולית. נסה שוב.',
        message
      );
    }
  }

  private isReplyToBotMessage(message: proto.IWebMessageInfo): boolean {
    const contextInfo =
      message.message?.extendedTextMessage?.contextInfo
      || message.message?.audioMessage?.contextInfo;
    if (!contextInfo?.participant) return false;

    const botJid = this.whatsapp.getBotJid();
    const botLid = this.whatsapp.getBotLid();
    if (!botJid && !botLid) return false;

    // Check both phone JID and LID formats
    const participantNormalized = contextInfo.participant.replace(/:.*@/, '@');
    return participantNormalized === botJid || participantNormalized === botLid;
  }

  private isMentioningBot(message: proto.IWebMessageInfo): boolean {
    const contextInfo =
      message.message?.extendedTextMessage?.contextInfo
      || message.message?.audioMessage?.contextInfo;
    const mentionedJids = contextInfo?.mentionedJid;
    if (!mentionedJids || mentionedJids.length === 0) return false;

    const botJid = this.whatsapp.getBotJid();
    const botLid = this.whatsapp.getBotLid();

    // Check if any mentioned JID matches the bot's JID or LID
    return mentionedJids.some(jid => {
      const normalizedJid = jid.replace(/:.*@/, '@');
      return normalizedJid === botJid || normalizedJid === botLid;
    });
  }

  private async handleCommand(
    jid: string,
    command: string,
    originalMessage: proto.IWebMessageInfo
  ): Promise<void> {
    const [cmd, ...args] = command.slice(1).split(' ');

    switch (cmd.toLowerCase()) {
      case 'clear':
        this.gemini.clearHistory(jid);
        await this.whatsapp.sendReply(
          jid,
          'Conversation history cleared.',
          originalMessage
        );
        break;

      case 'help':
        await this.whatsapp.sendReply(jid, this.getHelpText(), originalMessage);
        break;

      case 'groups':
        await this.handleGroupsCommand(jid, originalMessage);
        break;

      case 'schedule':
        await this.handleScheduleCommand(jid, args, originalMessage);
        break;

      case 'scheduled':
        await this.handleListScheduledCommand(jid, originalMessage);
        break;

      case 'image':
        await this.handleImageGeneration(jid, args.join(' '), originalMessage);
        break;

      case 'birthdays':
        await this.handleBirthdaysCommand(jid, args, originalMessage);
        break;

      default:
        await this.whatsapp.sendReply(
          jid,
          `Unknown command: /${cmd}\n\nType /help for available commands.`,
          originalMessage
        );
    }
  }

  private async handleGroupsCommand(
    jid: string,
    originalMessage: proto.IWebMessageInfo
  ): Promise<void> {
    try {
      const groups = await this.whatsapp.getGroups();
      if (groups.length === 0) {
        await this.whatsapp.sendReply(jid, 'No groups found.', originalMessage);
        return;
      }

      const groupList = groups
        .map((g, i) => `${i + 1}. ${g.name}\n   ID: ${g.id}`)
        .join('\n\n');

      await this.whatsapp.sendReply(
        jid,
        `*Your Groups:*\n\n${groupList}`,
        originalMessage
      );
    } catch (error) {
      logger.error('Error fetching groups:', error);
      await this.whatsapp.sendReply(
        jid,
        'Error fetching groups.',
        originalMessage
      );
    }
  }

  private async handleScheduleCommand(
    jid: string,
    args: string[],
    originalMessage: proto.IWebMessageInfo
  ): Promise<void> {
    // Format: /schedule <target_jid> <cron> <message>
    // Example: /schedule 123456789@g.us "0 9 * * *" Good morning!

    if (args.length < 3) {
      await this.whatsapp.sendReply(
        jid,
        `*Schedule Message Usage:*\n\n/schedule <jid> "<cron>" <message>\n\nExample:\n/schedule 123456789@g.us "0 9 * * *" Good morning!\n\nCron format: minute hour day month weekday`,
        originalMessage
      );
      return;
    }

    const targetJid = args[0];

    // Extract cron expression (in quotes)
    const cronMatch = args.slice(1).join(' ').match(/"([^"]+)"\s+(.*)/);
    if (!cronMatch) {
      await this.whatsapp.sendReply(
        jid,
        'Invalid format. Put cron expression in quotes: "0 9 * * *"',
        originalMessage
      );
      return;
    }

    const cronExpression = cronMatch[1];
    const message = cronMatch[2];

    try {
      const id = this.scheduler.scheduleMessage(targetJid, message, cronExpression);
      await this.whatsapp.sendReply(
        jid,
        `Message scheduled!\nID: ${id}\nTarget: ${targetJid}\nCron: ${cronExpression}\nMessage: ${message}`,
        originalMessage
      );
    } catch (error) {
      await this.whatsapp.sendReply(
        jid,
        `Error scheduling message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        originalMessage
      );
    }
  }

  private async handleListScheduledCommand(
    jid: string,
    originalMessage: proto.IWebMessageInfo
  ): Promise<void> {
    const scheduled = this.scheduler.listScheduledMessages();

    if (scheduled.length === 0) {
      await this.whatsapp.sendReply(
        jid,
        'No scheduled messages.',
        originalMessage
      );
      return;
    }

    const list = scheduled
      .map(
        (s, i) =>
          `${i + 1}. ${s.useAi ? '[AI] ' : ''}ID: ${s.id}\n   To: ${s.jid}\n   Cron: ${s.cronExpression}\n   ${s.useAi ? 'Prompt' : 'Message'}: ${s.message.substring(0, 50)}${s.message.length > 50 ? '...' : ''}`
      )
      .join('\n\n');

    await this.whatsapp.sendReply(
      jid,
      `*Scheduled Messages:*\n\n${list}`,
      originalMessage
    );
  }

  private async handleBirthdaysCommand(
    jid: string,
    args: string[],
    originalMessage: proto.IWebMessageInfo
  ): Promise<void> {
    const subCommand = args[0]?.toLowerCase();

    // /birthdays - show help
    if (!subCommand) {
      await this.whatsapp.sendReply(
        jid,
        `*ניהול ימי הולדת 🎂*

*הוספת רשימה:*
/birthdays add <רשימה>
דוגמה: /birthdays add איתי 5 פבר יהודה 25 מרץ שרה 15/12

*הצגת רשימה:*
/birthdays list

*מחיקה:*
/birthdays delete <מספר>

הבוט ישלח ברכה אוטומטית בכל יום הולדת ב-8:00 בבוקר!`,
        originalMessage
      );
      return;
    }

    if (subCommand === 'add') {
      const listText = args.slice(1).join(' ');
      if (!listText.trim()) {
        await this.whatsapp.sendReply(
          jid,
          'אנא ציין רשימת ימי הולדת.\nדוגמה: /birthdays add איתי 5 פבר יהודה 25 מרץ',
          originalMessage
        );
        return;
      }

      try {
        await this.whatsapp.sendReply(jid, 'מעבד את הרשימה...', originalMessage);

        const parsed = await this.birthdayService.parseBirthdayList(jid, listText);
        const ids = this.birthdayService.addBirthdays(parsed);

        const monthNames = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
          'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

        const summary = parsed.map((b, i) =>
          `${i + 1}. ${b.person_name} - ${b.birth_day} ${monthNames[b.birth_month - 1]}`
        ).join('\n');

        await this.whatsapp.sendReply(
          jid,
          `נוספו ${ids.length} ימי הולדת:\n\n${summary}\n\nאשלח ברכות אוטומטית בכל יום הולדת ב-8:00!`,
          originalMessage
        );
      } catch (error) {
        logger.error('Failed to add birthdays:', error);
        await this.whatsapp.sendReply(
          jid,
          `שגיאה: ${error instanceof Error ? error.message : 'לא הצלחתי להוסיף את ימי ההולדת'}`,
          originalMessage
        );
      }
      return;
    }

    if (subCommand === 'list') {
      const birthdays = this.birthdayService.getBirthdaysByJid(jid);

      if (birthdays.length === 0) {
        await this.whatsapp.sendReply(
          jid,
          'אין ימי הולדת שמורים עדיין.\nהוסף עם: /birthdays add <רשימה>',
          originalMessage
        );
        return;
      }

      const monthNames = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
        'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

      const list = birthdays.map((b, i) =>
        `${i + 1}. ${b.person_name} - ${b.birth_day} ${monthNames[b.birth_month - 1]} (ID: ${b.id})`
      ).join('\n');

      await this.whatsapp.sendReply(
        jid,
        `*ימי הולדת שמורים 🎂*\n\n${list}\n\nמחק עם: /birthdays delete <ID>`,
        originalMessage
      );
      return;
    }

    if (subCommand === 'delete') {
      const idStr = args[1];
      if (!idStr) {
        await this.whatsapp.sendReply(jid, 'ציין ID למחיקה. דוגמה: /birthdays delete 5', originalMessage);
        return;
      }

      const id = parseInt(idStr);
      if (isNaN(id)) {
        await this.whatsapp.sendReply(jid, 'ID לא תקין', originalMessage);
        return;
      }

      const deleted = this.birthdayService.deleteBirthday(id);
      if (deleted) {
        await this.whatsapp.sendReply(jid, 'יום ההולדת נמחק', originalMessage);
      } else {
        await this.whatsapp.sendReply(jid, 'לא נמצא יום הולדת עם ID זה', originalMessage);
      }
      return;
    }

    await this.whatsapp.sendReply(
      jid,
      `פקודה לא מוכרת: ${subCommand}\nכתוב /birthdays לעזרה`,
      originalMessage
    );
  }

  private extractImagePrompt(text: string): string | null {
    const lower = text.toLowerCase();

    // Hebrew triggers
    const hebrewPatterns = [
      /^(?:תייצר|ייצר|לייצר|צור|תצור)\s+(?:לי\s+)?תמונה\s+(?:של\s+)?(.+)/i,
      /^(?:תצייר|צייר|לצייר)\s+(?:לי\s+)?(.+)/i,
      /^תמונה\s+של\s+(.+)/i,
    ];

    for (const pattern of hebrewPatterns) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }

    // English triggers
    const englishPatterns = [
      /^(?:generate|create)\s+(?:an?\s+)?image\s+(?:of\s+)?(.+)/i,
      /^(?:draw|imagine)\s+(.+)/i,
    ];

    for (const pattern of englishPatterns) {
      const match = lower.match(pattern);
      if (match) return match[1].trim();
    }

    return null;
  }

  private async handleImageGeneration(
    jid: string,
    prompt: string,
    originalMessage: proto.IWebMessageInfo
  ): Promise<void> {
    if (!prompt.trim()) {
      await this.whatsapp.sendReply(
        jid,
        'מה לצייר? כתוב תיאור.\nדוגמה: /image חתול על הירח',
        originalMessage
      );
      return;
    }

    try {
      await this.whatsapp.sendReply(jid, '🎨 מייצר תמונה...', originalMessage);

      const result = await this.gemini.generateImage(prompt.trim());
      if (result) {
        await this.whatsapp.sendImageReply(
          jid,
          result.image,
          result.text || '',
          originalMessage
        );
      } else {
        await this.whatsapp.sendReply(
          jid,
          'לא הצלחתי ליצור את התמונה. נסה תיאור אחר.',
          originalMessage
        );
      }
    } catch (error) {
      logger.error('Error generating image:', error);
      await this.whatsapp.sendReply(
        jid,
        'שגיאה ביצירת התמונה. נסה שוב.',
        originalMessage
      );
    }
  }

  private getHelpText(): string {
    return `*Bayles Bot - Help*

*Chat with AI:*
${config.botPrefix} <your message>

*Image Generation:*
/image <description> - Generate an image
Or: "ייצר תמונה של..." / "תצייר..."

*Birthday Reminders:*
/birthdays - Manage birthdays
/birthdays add <list> - Add birthdays
/birthdays list - Show saved birthdays
/birthdays delete <id> - Remove birthday

*Commands:*
/help - Show this help message
/clear - Clear conversation history
/image - Generate an image from text
/groups - List all groups with IDs
/schedule - Schedule a message
/scheduled - List scheduled messages

*Examples:*
${config.botPrefix} What's the weather like?
${config.botPrefix} Tell me a joke
/image a cat sitting on the moon
ייצר תמונה של חתול על הירח
/birthdays add איתי 5 פבר יהודה 25 מרץ`;
  }
}
