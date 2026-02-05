import { ChatConfig, CreateChatConfig, UpdateChatConfig } from '../database/repositories/chat-config.repository.js';
import { ResponseStatus, ActivityStats, ActivityLogEntry } from '../database/repositories/activity-log.repository.js';
export interface MessageDecision {
    shouldRespond: boolean;
    responseType: 'ai' | 'auto_reply' | 'none';
    customPrompt?: string;
    autoReplyMessage?: string;
    reason: string;
}
export declare class BotControlService {
    private settingsRepo;
    private chatConfigRepo;
    private activityRepo;
    constructor();
    /**
     * Main decision function - determines if and how to respond to a message
     */
    shouldRespondToMessage(jid: string, isGroup: boolean): MessageDecision;
    /**
     * Log message activity
     */
    logActivity(jid: string, sender: string | undefined, message: string, isGroup: boolean, status: ResponseStatus, reason: string): void;
    isBotEnabled(): boolean;
    setBotEnabled(enabled: boolean): void;
    getSettings(): Record<string, string>;
    updateSetting(key: string, value: string): void;
    getAllChats(): ChatConfig[];
    getEnabledChats(): ChatConfig[];
    getChatConfig(jid: string): ChatConfig | null;
    addChat(config: CreateChatConfig): ChatConfig;
    updateChat(jid: string, updates: UpdateChatConfig): ChatConfig | null;
    removeChat(jid: string): boolean;
    toggleChat(jid: string, enabled: boolean): void;
    /**
     * Auto-whitelist a chat if not already in the list.
     * Returns true if a new entry was created.
     */
    ensureChatWhitelisted(jid: string, displayName?: string, isGroup?: boolean): boolean;
    getActivityLog(limit?: number, offset?: number): ActivityLogEntry[];
    getActivityStats(): ActivityStats;
    getActivityByChat(jid: string, limit?: number): ActivityLogEntry[];
    cleanOldActivity(daysToKeep?: number): number;
}
export declare function getBotControlService(): BotControlService;
