export interface ChatConfig {
    jid: string;
    display_name: string | null;
    is_group: number;
    enabled: number;
    ai_mode: 'on' | 'off';
    custom_prompt: string | null;
    auto_reply_message: string | null;
    schedule_enabled: number;
    schedule_start_hour: number;
    schedule_end_hour: number;
    schedule_days: string;
    allowed_tools: string | null;
    inject_user_memory: number;
    created_at: string;
    updated_at: string;
}
export interface CreateChatConfig {
    jid: string;
    display_name?: string;
    is_group?: boolean;
    enabled?: boolean;
    ai_mode?: 'on' | 'off';
    custom_prompt?: string;
    auto_reply_message?: string;
    schedule_enabled?: boolean;
    schedule_start_hour?: number;
    schedule_end_hour?: number;
    schedule_days?: string;
}
export interface UpdateChatConfig {
    display_name?: string;
    enabled?: boolean;
    ai_mode?: 'on' | 'off';
    custom_prompt?: string | null;
    auto_reply_message?: string | null;
    schedule_enabled?: boolean;
    schedule_start_hour?: number;
    schedule_end_hour?: number;
    schedule_days?: string;
    allowed_tools?: string[] | null;
    inject_user_memory?: boolean;
}
export declare class ChatConfigRepository {
    private db;
    getAll(): ChatConfig[];
    getAllEnabled(): ChatConfig[];
    getByJid(jid: string): ChatConfig | null;
    isEnabled(jid: string): boolean;
    create(config: CreateChatConfig): ChatConfig;
    update(jid: string, updates: UpdateChatConfig): ChatConfig | null;
    delete(jid: string): boolean;
    setEnabled(jid: string, enabled: boolean): void;
    /**
     * Check if a specific tool is allowed for a chat.
     * Returns true if allowed_tools is null (all tools allowed) or if the tool is in the list.
     */
    isToolAllowed(jid: string, toolName: string): boolean;
    /**
     * Get the list of allowed tools for a chat, or null if all are allowed.
     */
    getAllowedTools(jid: string): string[] | null;
    /**
     * Check if user memory should be injected for a chat.
     */
    shouldInjectMemory(jid: string): boolean;
    isWithinSchedule(jid: string): boolean;
}
export declare function getChatConfigRepository(): ChatConfigRepository;
