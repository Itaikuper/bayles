export interface BotSetting {
    key: string;
    value: string;
    updated_at: string;
}
export declare class BotSettingsRepository {
    private db;
    get(key: string): string | null;
    set(key: string, value: string): void;
    getAll(): BotSetting[];
    isBotEnabled(): boolean;
    setBotEnabled(enabled: boolean): void;
    getDefaultBehavior(): string;
    shouldLogAllMessages(): boolean;
}
export declare function getBotSettingsRepository(): BotSettingsRepository;
