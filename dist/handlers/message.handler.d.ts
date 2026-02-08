import { proto } from '@whiskeysockets/baileys';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { GeminiService } from '../services/gemini.service.js';
import { SchedulerService } from '../services/scheduler.service.js';
import { BotControlService } from '../services/bot-control.service.js';
import { BirthdayService } from '../services/birthday.service.js';
export declare class MessageHandler {
    private whatsapp;
    private gemini;
    private scheduler;
    private botControl;
    private birthdayService;
    private voiceModeJids;
    constructor(whatsapp: WhatsAppService, gemini: GeminiService, scheduler: SchedulerService, botControl: BotControlService, birthdayService: BirthdayService);
    handle(message: proto.IWebMessageInfo): Promise<void>;
    private extractText;
    private handleAudioMessage;
    private handleImageMessage;
    private handleDocumentMessage;
    private parseImageTags;
    private sendResponseWithImages;
    private sendResponse;
    private isReplyToBotMessage;
    private isMentioningBot;
    private handleCommand;
    private handleGroupsCommand;
    private handleScheduleCommand;
    private handleListScheduledCommand;
    /**
     * Handle natural language schedule requests via Gemini function calling
     */
    private handleScheduleFunctionCall;
    /**
     * Handle song search via Gemini function calling
     */
    private handleSongSearch;
    /**
     * Handle contact search via Gemini function calling
     */
    private handleContactSearch;
    /**
     * Resolve target name to JID - search in bot's groups or use current chat
     */
    private resolveScheduleTarget;
    /**
     * Get display name for a JID (group name or contact name)
     */
    private getTargetDisplayName;
    /**
     * Build cron expression from hour, minute, and days array
     */
    private buildCronExpression;
    /**
     * Format days array to human readable Hebrew description
     */
    private formatDaysDescription;
    private handleBirthdaysCommand;
    private extractImagePrompt;
    private handleImageGeneration;
    private getHelpText;
}
