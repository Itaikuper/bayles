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
    isWithinSchedule(jid: string): boolean;
}
export declare function getChatConfigRepository(): ChatConfigRepository;
