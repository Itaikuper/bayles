import { getBotSettingsRepository, BotSettingsRepository } from '../database/repositories/bot-settings.repository.js';
import {
  getChatConfigRepository,
  ChatConfigRepository,
  ChatConfig,
  CreateChatConfig,
  UpdateChatConfig,
} from '../database/repositories/chat-config.repository.js';
import {
  getActivityLogRepository,
  ActivityLogRepository,
  ResponseStatus,
  ActivityStats,
  ActivityLogEntry,
} from '../database/repositories/activity-log.repository.js';
import { logger } from '../utils/logger.js';

export interface MessageDecision {
  shouldRespond: boolean;
  responseType: 'ai' | 'auto_reply' | 'none';
  customPrompt?: string;
  autoReplyMessage?: string;
  reason: string;
}

export class BotControlService {
  private settingsRepo: BotSettingsRepository;
  private chatConfigRepo: ChatConfigRepository;
  private activityRepo: ActivityLogRepository;

  constructor() {
    this.settingsRepo = getBotSettingsRepository();
    this.chatConfigRepo = getChatConfigRepository();
    this.activityRepo = getActivityLogRepository();
  }

  /**
   * Main decision function - determines if and how to respond to a message
   */
  shouldRespondToMessage(jid: string, isGroup: boolean): MessageDecision {
    // Step 1: Check if bot is globally enabled
    if (!this.settingsRepo.isBotEnabled()) {
      return {
        shouldRespond: false,
        responseType: 'none',
        reason: 'Bot is disabled globally',
      };
    }

    // Step 2: Check if chat is in whitelist
    const chatConfig = this.chatConfigRepo.getByJid(jid);
    if (!chatConfig) {
      return {
        shouldRespond: false,
        responseType: 'none',
        reason: 'Chat not in whitelist',
      };
    }

    // Step 3: Check if chat is enabled
    if (!chatConfig.enabled) {
      return {
        shouldRespond: false,
        responseType: 'none',
        reason: 'Chat is disabled',
      };
    }

    // Step 4: Check schedule
    if (!this.chatConfigRepo.isWithinSchedule(jid)) {
      return {
        shouldRespond: false,
        responseType: 'none',
        reason: 'Outside scheduled hours',
      };
    }

    // Step 5: Determine response type based on AI mode
    if (chatConfig.ai_mode === 'on') {
      return {
        shouldRespond: true,
        responseType: 'ai',
        customPrompt: chatConfig.custom_prompt || undefined,
        reason: 'AI mode enabled for this chat',
      };
    }

    // AI mode is off - check for auto reply
    if (chatConfig.auto_reply_message) {
      return {
        shouldRespond: true,
        responseType: 'auto_reply',
        autoReplyMessage: chatConfig.auto_reply_message,
        reason: 'Auto-reply message configured',
      };
    }

    // AI off and no auto-reply
    return {
      shouldRespond: false,
      responseType: 'none',
      reason: 'AI mode off, no auto-reply configured',
    };
  }

  /**
   * Log message activity
   */
  logActivity(
    jid: string,
    sender: string | undefined,
    message: string,
    isGroup: boolean,
    status: ResponseStatus,
    reason: string
  ): void {
    if (this.settingsRepo.shouldLogAllMessages()) {
      this.activityRepo.log({
        jid,
        sender,
        message,
        is_group: isGroup,
        response_status: status,
        reason,
      });
    }
  }

  // ============== Global Settings ==============

  isBotEnabled(): boolean {
    return this.settingsRepo.isBotEnabled();
  }

  setBotEnabled(enabled: boolean): void {
    this.settingsRepo.setBotEnabled(enabled);
    logger.info(`Bot ${enabled ? 'enabled' : 'disabled'} globally`);
  }

  getSettings(): Record<string, string> {
    const settings = this.settingsRepo.getAll();
    const result: Record<string, string> = {};
    for (const setting of settings) {
      result[setting.key] = setting.value;
    }
    return result;
  }

  updateSetting(key: string, value: string): void {
    this.settingsRepo.set(key, value);
  }

  // ============== Chat Configs (Whitelist) ==============

  getAllChats(): ChatConfig[] {
    return this.chatConfigRepo.getAll();
  }

  getEnabledChats(): ChatConfig[] {
    return this.chatConfigRepo.getAllEnabled();
  }

  getChatConfig(jid: string): ChatConfig | null {
    return this.chatConfigRepo.getByJid(jid);
  }

  addChat(config: CreateChatConfig): ChatConfig {
    const existing = this.chatConfigRepo.getByJid(config.jid);
    if (existing) {
      throw new Error('Chat already exists in whitelist');
    }
    const created = this.chatConfigRepo.create(config);
    logger.info(`Added chat to whitelist: ${config.jid}`);
    return created;
  }

  updateChat(jid: string, updates: UpdateChatConfig): ChatConfig | null {
    const updated = this.chatConfigRepo.update(jid, updates);
    if (updated) {
      logger.info(`Updated chat config: ${jid}`);
    }
    return updated;
  }

  removeChat(jid: string): boolean {
    const removed = this.chatConfigRepo.delete(jid);
    if (removed) {
      logger.info(`Removed chat from whitelist: ${jid}`);
    }
    return removed;
  }

  toggleChat(jid: string, enabled: boolean): void {
    this.chatConfigRepo.setEnabled(jid, enabled);
    logger.info(`Chat ${jid} ${enabled ? 'enabled' : 'disabled'}`);
  }

  // ============== Activity Log ==============

  getActivityLog(limit?: number, offset?: number): ActivityLogEntry[] {
    return this.activityRepo.getRecent(limit, offset);
  }

  getActivityStats(): ActivityStats {
    return this.activityRepo.getStats();
  }

  getActivityByChat(jid: string, limit?: number): ActivityLogEntry[] {
    return this.activityRepo.getByJid(jid, limit);
  }

  cleanOldActivity(daysToKeep?: number): number {
    return this.activityRepo.clearOld(daysToKeep);
  }
}

let serviceInstance: BotControlService | null = null;

export function getBotControlService(): BotControlService {
  if (!serviceInstance) {
    serviceInstance = new BotControlService();
  }
  return serviceInstance;
}
