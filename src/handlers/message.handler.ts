import { proto } from '@whiskeysockets/baileys';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { GeminiService } from '../services/gemini.service.js';
import { SchedulerService } from '../services/scheduler.service.js';
import { BotControlService } from '../services/bot-control.service.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

export class MessageHandler {
  constructor(
    private whatsapp: WhatsAppService,
    private gemini: GeminiService,
    private scheduler: SchedulerService,
    private botControl: BotControlService
  ) {}

  async handle(message: proto.IWebMessageInfo): Promise<void> {
    const jid = message.key.remoteJid;
    if (!jid) return;

    const text = this.extractText(message);
    if (!text) return;

    const isGroup = jid.endsWith('@g.us');
    const sender = isGroup ? message.key.participant : jid;

    logger.info(`Message from ${sender} in ${isGroup ? 'group' : 'DM'}: ${text}`);

    // For groups, check if message starts with prefix
    const hasPrefix = text.startsWith(config.botPrefix);

    // Check if the message is a reply to the bot
    const isReplyToBot = this.isReplyToBotMessage(message);

    // Remove prefix if present
    const cleanText = hasPrefix
      ? text.slice(config.botPrefix.length).trim()
      : text;

    // For groups: respond only if has prefix OR is a reply to bot
    if (isGroup && !hasPrefix && !isReplyToBot) {
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

    // Generate AI response
    try {
      const response = await this.gemini.generateResponse(
        jid,
        cleanText,
        decision.customPrompt // Pass custom prompt if configured
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

  private isReplyToBotMessage(message: proto.IWebMessageInfo): boolean {
    const contextInfo = message.message?.extendedTextMessage?.contextInfo;
    if (!contextInfo?.participant) return false;

    const botJid = this.whatsapp.getBotJid();
    if (!botJid) return false;

    // Normalize the participant JID for comparison
    const participantNormalized = contextInfo.participant.replace(/:.*@/, '@');
    return participantNormalized === botJid;
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
          `${i + 1}. ID: ${s.id}\n   To: ${s.jid}\n   Cron: ${s.cronExpression}\n   Message: ${s.message.substring(0, 50)}${s.message.length > 50 ? '...' : ''}`
      )
      .join('\n\n');

    await this.whatsapp.sendReply(
      jid,
      `*Scheduled Messages:*\n\n${list}`,
      originalMessage
    );
  }

  private getHelpText(): string {
    return `*Bayles Bot - Help*

*Chat with AI:*
${config.botPrefix} <your message>

*Commands:*
/help - Show this help message
/clear - Clear conversation history
/groups - List all groups with IDs
/schedule - Schedule a message
/scheduled - List scheduled messages

*Examples:*
${config.botPrefix} What's the weather like?
${config.botPrefix} Tell me a joke
/schedule 123@g.us "0 9 * * *" Good morning!`;
  }
}
