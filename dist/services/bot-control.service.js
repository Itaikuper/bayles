import { getBotSettingsRepository } from '../database/repositories/bot-settings.repository.js';
import { getChatConfigRepository, } from '../database/repositories/chat-config.repository.js';
import { getActivityLogRepository, } from '../database/repositories/activity-log.repository.js';
import { logger } from '../utils/logger.js';
export class BotControlService {
    settingsRepo;
    chatConfigRepo;
    activityRepo;
    constructor() {
        this.settingsRepo = getBotSettingsRepository();
        this.chatConfigRepo = getChatConfigRepository();
        this.activityRepo = getActivityLogRepository();
    }
    /**
     * Main decision function - determines if and how to respond to a message
     */
    shouldRespondToMessage(jid, isGroup) {
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
    logActivity(jid, sender, message, isGroup, status, reason) {
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
    isBotEnabled() {
        return this.settingsRepo.isBotEnabled();
    }
    setBotEnabled(enabled) {
        this.settingsRepo.setBotEnabled(enabled);
        logger.info(`Bot ${enabled ? 'enabled' : 'disabled'} globally`);
    }
    getSettings() {
        const settings = this.settingsRepo.getAll();
        const result = {};
        for (const setting of settings) {
            result[setting.key] = setting.value;
        }
        return result;
    }
    updateSetting(key, value) {
        this.settingsRepo.set(key, value);
    }
    // ============== Chat Configs (Whitelist) ==============
    getAllChats() {
        return this.chatConfigRepo.getAll();
    }
    getEnabledChats() {
        return this.chatConfigRepo.getAllEnabled();
    }
    getChatConfig(jid) {
        return this.chatConfigRepo.getByJid(jid);
    }
    addChat(config) {
        const existing = this.chatConfigRepo.getByJid(config.jid);
        if (existing) {
            throw new Error('Chat already exists in whitelist');
        }
        const created = this.chatConfigRepo.create(config);
        logger.info(`Added chat to whitelist: ${config.jid}`);
        return created;
    }
    updateChat(jid, updates) {
        const updated = this.chatConfigRepo.update(jid, updates);
        if (updated) {
            logger.info(`Updated chat config: ${jid}`);
        }
        return updated;
    }
    removeChat(jid) {
        const removed = this.chatConfigRepo.delete(jid);
        if (removed) {
            logger.info(`Removed chat from whitelist: ${jid}`);
        }
        return removed;
    }
    toggleChat(jid, enabled) {
        this.chatConfigRepo.setEnabled(jid, enabled);
        logger.info(`Chat ${jid} ${enabled ? 'enabled' : 'disabled'}`);
    }
    /**
     * Auto-whitelist a chat if not already in the list.
     * Returns true if a new entry was created.
     */
    ensureChatWhitelisted(jid, displayName, isGroup) {
        const existing = this.chatConfigRepo.getByJid(jid);
        if (existing)
            return false;
        this.chatConfigRepo.create({
            jid,
            display_name: displayName,
            is_group: isGroup,
            enabled: true,
            ai_mode: 'on',
        });
        logger.info(`Auto-whitelisted: ${jid}${displayName ? ` (${displayName})` : ''}`);
        return true;
    }
    // ============== Activity Log ==============
    getActivityLog(limit, offset) {
        return this.activityRepo.getRecent(limit, offset);
    }
    getActivityStats() {
        return this.activityRepo.getStats();
    }
    getActivityByChat(jid, limit) {
        return this.activityRepo.getByJid(jid, limit);
    }
    cleanOldActivity(daysToKeep) {
        return this.activityRepo.clearOld(daysToKeep);
    }
}
let serviceInstance = null;
export function getBotControlService() {
    if (!serviceInstance) {
        serviceInstance = new BotControlService();
    }
    return serviceInstance;
}
