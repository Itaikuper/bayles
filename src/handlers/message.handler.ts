import { proto } from '@whiskeysockets/baileys';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { GeminiService } from '../services/gemini.service.js';
import { SchedulerService } from '../services/scheduler.service.js';
import { BotControlService } from '../services/bot-control.service.js';
import { BirthdayService } from '../services/birthday.service.js';
import { ScheduleRepository } from '../database/repositories/schedule.repository.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { ScheduleArgs } from '../types/index.js';
import { getSongRepository } from '../database/repositories/song.repository.js';
import { getContactRepository } from '../database/repositories/contact.repository.js';

export class MessageHandler {
  private voiceModeJids: Set<string> = new Set();

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

    // Update display_name from pushName for DM chats
    if (message.pushName && !jid.endsWith('@g.us')) {
      const existingConfig = this.botControl.getChatConfig(jid);
      const nameIsMissing = !existingConfig?.display_name || existingConfig.display_name === jid;
      if (existingConfig && nameIsMissing) {
        this.botControl.updateChat(jid, { display_name: message.pushName });
        logger.info(`Saved display_name "${message.pushName}" for ${jid}`);
      }
    }

    // Debug: log which message types are present
    const msg = message.message;
    const msgTypes = msg ? Object.keys(msg).filter(k => msg[k as keyof typeof msg] != null) : [];
    logger.info(`DEBUG msgTypes: ${JSON.stringify(msgTypes)} from ${message.key.participant || jid}`);

    // Handle voice/audio messages
    const audioMessage = message.message?.audioMessage;
    if (audioMessage) {
      await this.handleAudioMessage(message, jid, audioMessage);
      return;
    }

    // Handle image messages (photos from camera/gallery)
    const imageMessage = message.message?.imageMessage;
    if (imageMessage) {
      await this.handleImageMessage(message, jid, imageMessage);
      return;
    }

    // Handle document messages (PDF, DOC, etc.)
    const documentMessage = message.message?.documentMessage;
    if (documentMessage) {
      await this.handleDocumentMessage(message, jid, documentMessage);
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
    const hasTriggerWord = /(?:^|[\s,.!?])(?:פרופסור|בוט|bot)(?:[\s,.!?]|$)/i.test(text);

    // For groups: respond only if has prefix OR is a reply to bot OR mentions bot OR has trigger word
    if (isGroup && !hasPrefix && !isReplyToBot && !isMentioningBot && !hasTriggerWord) {
      return;
    }

    // Strip trigger word from beginning of message
    if (hasTriggerWord) {
      cleanText = cleanText.replace(/^(?:פרופסור|בוט|bot)[,\s]*/i, '').trim();
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
    const imageResult = this.extractImagePrompt(cleanText);
    if (imageResult !== null) {
      await this.handleImageGeneration(jid, imageResult.prompt, message, imageResult.pro);
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
        decision.customPrompt,
        'default',
        sender || undefined
      );

      // Handle function calls (e.g., scheduling)
      if (response.type === 'function_call' && response.functionCall) {
        if (response.functionCall.name === 'create_schedule') {
          const scheduleArgs = response.functionCall.args as unknown as ScheduleArgs;
          await this.handleScheduleFunctionCall(jid, scheduleArgs, message);
          return;
        }
        if (response.functionCall.name === 'search_song') {
          const args = response.functionCall.args as { query: string };
          await this.handleSongSearch(jid, args.query, message);
          return;
        }
        if (response.functionCall.name === 'search_contact') {
          const args = response.functionCall.args as { query: string };
          await this.handleContactSearch(jid, args.query, message);
          return;
        }
        // Unknown function call - log and ignore
        logger.warn(`Unknown function call: ${response.functionCall.name}`);
      }

      // Handle regular text response
      if (response.text) {
        await this.sendResponse(jid, response.text, message);

        // Extract user facts asynchronously (non-blocking)
        const senderJid = sender || jid;
        this.gemini.extractUserFacts(senderJid, cleanText, response.text)
          .catch(err => logger.warn('[memory] Extraction failed:', err));
      }
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

      // Voice mode: convert text response to speech
      if (this.voiceModeJids.has(jid)) {
        try {
          const speechBuffer = await this.gemini.generateSpeech(response);
          await this.whatsapp.sendVoiceReply(jid, speechBuffer, message);
        } catch (ttsError) {
          logger.error('Voice mode TTS failed for audio reply, falling back to text:', ttsError);
          await this.whatsapp.sendReply(jid, response, message);
        }
      } else {
        await this.whatsapp.sendReply(jid, response, message);
      }
    } catch (error) {
      logger.error('Error processing voice message:', error);
      await this.whatsapp.sendReply(
        jid,
        'סליחה, לא הצלחתי לעבד את ההודעה הקולית. נסה שוב.',
        message
      );
    }
  }

  private async handleImageMessage(
    message: proto.IWebMessageInfo,
    jid: string,
    imageMessage: proto.Message.IImageMessage
  ): Promise<void> {
    const isGroup = jid.endsWith('@g.us');
    const sender = isGroup ? message.key.participant : jid;
    const caption = imageMessage.caption || '';

    logger.info(`Image message from ${sender} in ${isGroup ? 'group' : 'DM'}${caption ? `: ${caption}` : ''}`);

    // In groups: only respond if reply-to-bot, mentioned, or caption has trigger word
    if (isGroup) {
      const isReplyToBot = this.isReplyToBotMessage(message);
      const isMentioned = this.isMentioningBot(message);
      const hasTriggerWord = /(?:^|[\s,.!?])(?:פרופסור|בוט|bot)(?:[\s,.!?]|$)/i.test(caption);

      if (!isReplyToBot && !isMentioned && !hasTriggerWord) {
        return;
      }
    }

    const decision = this.botControl.shouldRespondToMessage(jid, isGroup);

    this.botControl.logActivity(
      jid,
      sender || undefined,
      caption ? `[תמונה] ${caption}` : '[תמונה]',
      isGroup,
      decision.shouldRespond ? 'responded' : 'ignored',
      decision.reason
    );

    if (!decision.shouldRespond) {
      logger.info(`Not responding to image: ${decision.reason}`);
      return;
    }

    if (decision.responseType === 'auto_reply' && decision.autoReplyMessage) {
      await this.whatsapp.sendReply(jid, decision.autoReplyMessage, message);
      return;
    }

    try {
      const imageBuffer = await this.whatsapp.downloadImage(imageMessage);
      const mimeType = imageMessage.mimetype || 'image/jpeg';

      const contextPrefix = isGroup && message.pushName
        ? `[${message.pushName}]`
        : undefined;

      // Strip trigger words from caption
      const cleanCaption = caption
        ? caption.replace(/(?:^|[\s,.!?])(?:פרופסור|בוט|bot)(?:[\s,.!?]|$)/ig, ' ').trim()
        : undefined;

      const response = await this.gemini.generateDocumentAnalysisResponse(
        jid,
        imageBuffer,
        mimeType,
        cleanCaption || undefined,
        decision.customPrompt,
        contextPrefix
      );
      await this.sendResponse(jid, response, message);
    } catch (error) {
      logger.error('Error processing image:', error);
      await this.whatsapp.sendReply(
        jid,
        'סליחה, לא הצלחתי לעבד את התמונה. נסה שוב.',
        message
      );
    }
  }

  private async handleDocumentMessage(
    message: proto.IWebMessageInfo,
    jid: string,
    documentMessage: proto.Message.IDocumentMessage
  ): Promise<void> {
    const isGroup = jid.endsWith('@g.us');
    const sender = isGroup ? message.key.participant : jid;
    const fileName = documentMessage.fileName || 'document';

    const caption = documentMessage.caption || '';

    logger.info(`Document message from ${sender} in ${isGroup ? 'group' : 'DM'}: ${fileName}`);

    // In groups: only respond if reply-to-bot, mentioned, or caption has trigger word
    if (isGroup) {
      const isReplyToBot = this.isReplyToBotMessage(message);
      const isMentioned = this.isMentioningBot(message);
      const hasTriggerWord = /(?:^|[\s,.!?])(?:פרופסור|בוט|bot)(?:[\s,.!?]|$)/i.test(caption);

      if (!isReplyToBot && !isMentioned && !hasTriggerWord) {
        return;
      }
    }

    const decision = this.botControl.shouldRespondToMessage(jid, isGroup);

    this.botControl.logActivity(
      jid,
      sender || undefined,
      `[קובץ: ${fileName}]`,
      isGroup,
      decision.shouldRespond ? 'responded' : 'ignored',
      decision.reason
    );

    if (!decision.shouldRespond) {
      logger.info(`Not responding to document: ${decision.reason}`);
      return;
    }

    if (decision.responseType === 'auto_reply' && decision.autoReplyMessage) {
      await this.whatsapp.sendReply(jid, decision.autoReplyMessage, message);
      return;
    }

    try {
      const docBuffer = await this.whatsapp.downloadDocument(documentMessage);
      const mimeType = documentMessage.mimetype || 'application/pdf';
      logger.info(`DEBUG doc download: ${docBuffer.length} bytes, mime: ${mimeType}, file: ${fileName}`);

      const contextPrefix = isGroup && message.pushName
        ? `[${message.pushName}]`
        : undefined;

      // Strip trigger words from caption
      const cleanCaption = caption
        ? caption.replace(/(?:^|[\s,.!?])(?:פרופסור|בוט|bot)(?:[\s,.!?]|$)/ig, ' ').trim()
        : undefined;

      const response = await this.gemini.generateDocumentAnalysisResponse(
        jid,
        docBuffer,
        mimeType,
        cleanCaption || undefined,
        decision.customPrompt,
        contextPrefix,
        fileName
      );
      await this.sendResponse(jid, response, message);
    } catch (error) {
      logger.error('Error processing document:', error);
      await this.whatsapp.sendReply(
        jid,
        'סליחה, לא הצלחתי לעבד את הקובץ. נסה שוב.',
        message
      );
    }
  }

  private parseImageTags(text: string): { cleanText: string; imagePrompts: { prompt: string; pro: boolean }[] } {
    const imagePrompts: { prompt: string; pro: boolean }[] = [];
    const tagRegex = /\[(PRO_IMAGE|IMAGE):\s*(.+?)\]/g;
    let match;
    while ((match = tagRegex.exec(text)) !== null) {
      const prompt = match[2].trim();
      if (prompt.length > 0) {
        imagePrompts.push({ prompt, pro: match[1] === 'PRO_IMAGE' });
      }
    }
    const cleanText = text
      .replace(/\[(?:PRO_IMAGE|IMAGE):\s*.+?\]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { cleanText, imagePrompts };
  }

  private async sendResponseWithImages(
    jid: string,
    response: string,
    message: proto.IWebMessageInfo
  ): Promise<void> {
    const parsed = this.parseImageTags(response);

    if (parsed.cleanText) {
      await this.whatsapp.sendReply(jid, parsed.cleanText, message);
    }

    if (config.autoImageGeneration && parsed.imagePrompts.length > 0) {
      for (const { prompt, pro } of parsed.imagePrompts.slice(0, 2)) {
        try {
          const fullPrompt = `${prompt}. If you include a text caption, write it in Hebrew.`;
          logger.info(`Auto-generating ${pro ? 'PRO ' : ''}image: "${prompt.substring(0, 80)}..."`);
          const result = await this.gemini.generateImage(fullPrompt, pro);
          if (result) {
            await this.whatsapp.sendImageReply(jid, result.image, result.text || '', message);
          }
        } catch (error) {
          logger.warn(`Auto image generation failed: ${error}`);
        }
      }
    }
  }

  private async sendResponse(
    jid: string,
    text: string,
    message: proto.IWebMessageInfo
  ): Promise<void> {
    if (!this.voiceModeJids.has(jid)) {
      await this.sendResponseWithImages(jid, text, message);
      return;
    }

    // Voice mode: convert text response to speech
    try {
      const audioBuffer = await this.gemini.generateSpeech(text);
      await this.whatsapp.sendVoiceReply(jid, audioBuffer, message);
    } catch (error) {
      logger.error('Voice mode TTS failed, falling back to text:', error);
      await this.sendResponseWithImages(jid, text, message);
    }
  }

  private isReplyToBotMessage(message: proto.IWebMessageInfo): boolean {
    const contextInfo =
      message.message?.extendedTextMessage?.contextInfo
      || message.message?.audioMessage?.contextInfo
      || message.message?.imageMessage?.contextInfo
      || message.message?.documentMessage?.contextInfo;
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
      || message.message?.audioMessage?.contextInfo
      || message.message?.imageMessage?.contextInfo
      || message.message?.documentMessage?.contextInfo;
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

      case 'proimage':
        await this.handleImageGeneration(jid, args.join(' '), originalMessage, true);
        break;

      case 'voice':
        if (this.voiceModeJids.has(jid)) {
          this.voiceModeJids.delete(jid);
          await this.whatsapp.sendReply(jid, 'מצב קול כבוי - חוזר לתשובות טקסט', originalMessage);
        } else {
          this.voiceModeJids.add(jid);
          await this.whatsapp.sendReply(jid, 'מצב קול פעיל - אענה בהודעות קוליות', originalMessage);
        }
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

  /**
   * Handle natural language schedule requests via Gemini function calling
   */
  private async handleScheduleFunctionCall(
    jid: string,
    args: ScheduleArgs,
    originalMessage: proto.IWebMessageInfo
  ): Promise<void> {
    try {
      // Normalize hour/minute - Gemini sometimes returns 14.25 instead of hour=14, minute=25
      let hour = Math.floor(args.hour);
      let minute = args.minute ?? 0;

      // If hour has decimal (e.g., 14.25), extract minutes from it
      if (args.hour !== hour) {
        const decimalPart = args.hour - hour;
        // Check if it looks like HH.MM format (e.g., 14.25 = 14:25)
        if (decimalPart > 0 && decimalPart < 1) {
          const possibleMinute = Math.round(decimalPart * 100);
          if (possibleMinute < 60) {
            minute = possibleMinute;
          }
        }
      }

      // Ensure minute is valid
      minute = Math.floor(minute);
      if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        await this.whatsapp.sendReply(jid, '❌ שעה לא תקינה. נסה פורמט כמו: 14:30 או 9 בבוקר', originalMessage);
        return;
      }

      logger.info(`Normalized time: ${hour}:${minute} (original: hour=${args.hour}, minute=${args.minute})`);

      // Resolve target - find group by name or use current chat
      const targetJid = await this.resolveScheduleTarget(args.targetName, jid);
      const targetName = await this.getTargetDisplayName(targetJid);

      let scheduleId: string;
      let scheduleDescription: string;

      const scheduleRepo = new ScheduleRepository();

      if (args.days && args.days.length > 0) {
        // Recurring schedule
        const cronExpression = this.buildCronExpression(hour, minute, args.days);
        scheduleId = this.scheduler.scheduleMessage(targetJid, args.message, cronExpression, false, args.useAi);
        scheduleDescription = this.formatDaysDescription(args.days, hour, minute);

        // Persist to database
        scheduleRepo.create({
          id: scheduleId,
          jid: targetJid,
          message: args.message,
          cronExpression,
          oneTime: false,
          useAi: args.useAi,
        });
      } else if (args.oneTimeDate) {
        // One-time schedule
        const scheduledDate = new Date(`${args.oneTimeDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);

        if (scheduledDate <= new Date()) {
          await this.whatsapp.sendReply(jid, '❌ התאריך כבר עבר. נסה תאריך עתידי.', originalMessage);
          return;
        }

        scheduleId = this.scheduler.scheduleOneTimeMessage(targetJid, args.message, scheduledDate, args.useAi);
        scheduleDescription = `${args.oneTimeDate} ב-${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

        // Persist to database
        scheduleRepo.create({
          id: scheduleId,
          jid: targetJid,
          message: args.message,
          cronExpression: 'one-time',
          oneTime: true,
          scheduledAt: scheduledDate.toISOString(),
          useAi: args.useAi,
        });
      } else {
        await this.whatsapp.sendReply(jid, '❌ לא הצלחתי להבין מתי לשלוח. נסה לציין ימים או תאריך.', originalMessage);
        return;
      }

      // Build confirmation message
      const targetText = targetJid === jid ? 'כאן' : targetName;
      const typeText = args.useAi ? '🤖 AI (תוכן חדש בכל פעם)' : '📝 טקסט קבוע';

      const confirmation = `✅ *תזמנתי!*

📍 יעד: ${targetText}
⏰ מתי: ${scheduleDescription}
${args.useAi ? '🤖 Prompt' : '💬 הודעה'}: "${args.message.length > 100 ? args.message.substring(0, 100) + '...' : args.message}"
📋 סוג: ${typeText}
🔑 ID: ${scheduleId}`;

      await this.whatsapp.sendReply(jid, confirmation, originalMessage);
      logger.info(`Natural language schedule created: ${scheduleId} for ${targetJid}`);
    } catch (error) {
      logger.error('Error creating schedule from function call:', error);
      await this.whatsapp.sendReply(
        jid,
        `❌ שגיאה ביצירת התזמון: ${error instanceof Error ? error.message : 'שגיאה לא ידועה'}`,
        originalMessage
      );
    }
  }

  /**
   * Handle song search via Gemini function calling
   */
  private async handleSongSearch(
    jid: string,
    query: string,
    originalMessage: proto.IWebMessageInfo
  ): Promise<void> {
    const songRepo = getSongRepository();
    const results = songRepo.search(query, 10);

    if (results.length === 0) {
      await this.whatsapp.sendReply(jid, `לא נמצאו שירים עבור "${query}". נסה חיפוש אחר.`, originalMessage);
      return;
    }

    if (results.length === 1) {
      const song = results[0];
      let text = `🎸 *${song.title}* - ${song.artist}`;
      if (song.capo) text += `\nCapo: ${song.capo}`;
      text += `\n\n${song.url}`;
      await this.whatsapp.sendReply(jid, text, originalMessage);
      return;
    }

    const list = results.map((s, i) =>
      `${i + 1}. *${s.title}* - ${s.artist}\n${s.url}`
    ).join('\n\n');

    await this.whatsapp.sendReply(
      jid,
      `🎸 נמצאו ${results.length} שירים:\n\n${list}`,
      originalMessage
    );
  }

  /**
   * Handle contact search via Gemini function calling
   */
  private async handleContactSearch(
    jid: string,
    query: string,
    originalMessage: proto.IWebMessageInfo
  ): Promise<void> {
    const contactRepo = getContactRepository();
    const results = contactRepo.search(query);

    if (results.length === 0) {
      await this.whatsapp.sendReply(jid, `לא נמצאו אנשי קשר עם השם "${query}".`, originalMessage);
      return;
    }

    const list = results.map((c, i) => {
      let line = `${i + 1}. *${c.name}*: ${c.phone}`;
      if (c.notes) line += ` (${c.notes})`;
      return line;
    }).join('\n');

    await this.whatsapp.sendReply(
      jid,
      `📞 נמצאו ${results.length} אנשי קשר:\n\n${list}`,
      originalMessage
    );
  }

  /**
   * Resolve target name to JID - search in bot's groups or use current chat
   */
  private async resolveScheduleTarget(targetName: string, currentJid: string): Promise<string> {
    // Self references
    const selfKeywords = ['self', 'לי', 'לעצמי', 'אלי', 'פה', 'כאן'];
    if (selfKeywords.includes(targetName.toLowerCase())) {
      return currentJid;
    }

    // Search in groups
    try {
      const groups = await this.whatsapp.getGroups();
      const normalizedTarget = targetName.toLowerCase().replace(/קבוצת\s*/i, '');

      // Try exact match first
      let match = groups.find(g => g.name.toLowerCase() === normalizedTarget);

      // Try partial match
      if (!match) {
        match = groups.find(g =>
          g.name.toLowerCase().includes(normalizedTarget) ||
          normalizedTarget.includes(g.name.toLowerCase())
        );
      }

      if (match) {
        logger.info(`Resolved target "${targetName}" to group ${match.name} (${match.id})`);
        return match.id;
      }
    } catch (error) {
      logger.warn('Error searching groups for target:', error);
    }

    // Fallback to current chat
    logger.info(`Could not find target "${targetName}", using current chat ${currentJid}`);
    return currentJid;
  }

  /**
   * Get display name for a JID (group name or contact name)
   */
  private async getTargetDisplayName(targetJid: string): Promise<string> {
    if (targetJid.endsWith('@g.us')) {
      try {
        const groups = await this.whatsapp.getGroups();
        const group = groups.find(g => g.id === targetJid);
        if (group) return group.name;
      } catch { /* ignore */ }
    }

    const config = this.botControl.getChatConfig(targetJid);
    return config?.display_name || targetJid;
  }

  /**
   * Build cron expression from hour, minute, and days array
   */
  private buildCronExpression(hour: number, minute: number, days: number[]): string {
    const daysPart = days.length === 7 ? '*' : days.join(',');
    return `${minute} ${hour} * * ${daysPart}`;
  }

  /**
   * Format days array to human readable Hebrew description
   */
  private formatDaysDescription(days: number[], hour: number, minute: number): string {
    const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    if (days.length === 7) {
      return `כל יום ב-${timeStr}`;
    }

    if (days.length === 5 && [0, 1, 2, 3, 4].every(d => days.includes(d))) {
      return `ימי חול ב-${timeStr}`;
    }

    if (days.length === 1) {
      return `כל יום ${dayNames[days[0]]} ב-${timeStr}`;
    }

    const daysList = days.map(d => dayNames[d]).join(', ');
    return `בימים ${daysList} ב-${timeStr}`;
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

  private extractImagePrompt(text: string): { prompt: string; pro: boolean } | null {
    const lower = text.toLowerCase();

    // Hebrew PRO triggers (check first)
    const hebrewProPatterns = [
      /^(?:תייצר|ייצר|לייצר|צור|תצור)\s+(?:לי\s+)?תמונת?\s+פרו\s+(?:של\s+)?(.+)/i,
      /^(?:תצייר|צייר|לצייר)\s+(?:לי\s+)?פרו\s+(.+)/i,
      /^תמונת?\s+פרו\s+(?:של\s+)?(.+)/i,
    ];

    for (const pattern of hebrewProPatterns) {
      const match = text.match(pattern);
      if (match) return { prompt: match[1].trim(), pro: true };
    }

    // Hebrew triggers
    const hebrewPatterns = [
      /^(?:תייצר|ייצר|לייצר|צור|תצור)\s+(?:לי\s+)?תמונה\s+(?:של\s+)?(.+)/i,
      /^(?:תצייר|צייר|לצייר)\s+(?:לי\s+)?(.+)/i,
      /^תמונה\s+של\s+(.+)/i,
    ];

    for (const pattern of hebrewPatterns) {
      const match = text.match(pattern);
      if (match) return { prompt: match[1].trim(), pro: false };
    }

    // English PRO triggers (check first)
    const englishProPatterns = [
      /^(?:generate|create)\s+(?:an?\s+)?pro\s+image\s+(?:of\s+)?(.+)/i,
      /^pro\s+(?:draw|imagine)\s+(.+)/i,
    ];

    for (const pattern of englishProPatterns) {
      const match = lower.match(pattern);
      if (match) return { prompt: match[1].trim(), pro: true };
    }

    // English triggers
    const englishPatterns = [
      /^(?:generate|create)\s+(?:an?\s+)?image\s+(?:of\s+)?(.+)/i,
      /^(?:draw|imagine)\s+(.+)/i,
    ];

    for (const pattern of englishPatterns) {
      const match = lower.match(pattern);
      if (match) return { prompt: match[1].trim(), pro: false };
    }

    return null;
  }

  private async handleImageGeneration(
    jid: string,
    prompt: string,
    originalMessage: proto.IWebMessageInfo,
    pro = false
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
      await this.whatsapp.sendReply(jid, pro ? '🎨 מייצר תמונת PRO...' : '🎨 מייצר תמונה...', originalMessage);

      const result = await this.gemini.generateImage(prompt.trim(), pro);
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
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error generating image:', error);
      await this.whatsapp.sendReply(
        jid,
        `שגיאה ביצירת התמונה: ${errMsg}`,
        originalMessage
      );
    }
  }

  private getHelpText(): string {
    return `*Bayles Bot - Help*

*Chat with AI:*
${config.botPrefix} <your message>

*כלי למידה:*
שלח תמונה או קובץ (PDF, מסמך) ואעזור לך:
- חזרה לקראת מבחן
- עזרה בפתרון תרגיל
- סיכום החומר
- שאלות תרגול

*Image Generation:*
/image <description> - Generate an image
/proimage <description> - Generate PRO image (higher quality)
Or: "ייצר תמונה של..." / "תצייר..."
PRO: "ייצר תמונת פרו של..." / "תמונת פרו של..."

*Birthday Reminders:*
/birthdays - Manage birthdays
/birthdays add <list> - Add birthdays
/birthdays list - Show saved birthdays
/birthdays delete <id> - Remove birthday

*Commands:*
/help - Show this help message
/clear - Clear conversation history
/voice - Toggle voice mode (respond with voice messages)
/image - Generate an image from text
/proimage - Generate PRO image (Nano Banana Pro)
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
