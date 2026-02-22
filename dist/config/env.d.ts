export declare const config: {
    geminiApiKey: string;
    geminiModel: string;
    authDir: string;
    botPrefix: string;
    familyGroupName: string;
    systemPrompt: string;
    autoImageGeneration: boolean;
    googleServiceAccountPath: string;
    calendarDailySummaryCron: string;
    calendarTimezone: string;
};
export declare function validateConfig(): void;
