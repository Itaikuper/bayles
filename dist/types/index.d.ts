import type { ScheduledTask } from 'node-cron';
export interface ScheduledMessage {
    id: string;
    jid: string;
    message: string;
    cronExpression: string;
    task: ScheduledTask;
    oneTime: boolean;
    useAi: boolean;
}
export interface ScheduledMessageInfo {
    id: string;
    jid: string;
    message: string;
    cronExpression: string;
    oneTime: boolean;
    useAi: boolean;
}
export interface BotConfig {
    geminiApiKey: string;
    geminiModel: string;
    authDir: string;
    botPrefix: string;
    systemPrompt: string;
}
export interface ChatHistory {
    role: 'user' | 'model';
    parts: {
        text: string;
    }[];
}
export interface ScheduleArgs {
    targetName: string;
    hour: number;
    minute: number;
    days?: number[];
    oneTimeDate?: string;
    message: string;
    useAi: boolean;
}
export interface GeminiResponse {
    type: 'text' | 'function_call';
    text?: string;
    functionCall?: {
        name: string;
        args: Record<string, unknown>;
    };
}
export interface CalendarListArgs {
    startDate?: string;
    endDate?: string;
    query?: string;
}
export interface CalendarCreateArgs {
    summary: string;
    date: string;
    startHour: number;
    startMinute?: number;
    durationMinutes?: number;
}
export interface CalendarUpdateArgs {
    searchQuery: string;
    searchDate: string;
    newSummary?: string;
    newDate?: string;
    newStartHour?: number;
    newStartMinute?: number;
}
export interface CalendarDeleteArgs {
    searchQuery: string;
    searchDate: string;
}
export interface SendMessageArgs {
    targetName: string;
    messageContent: string;
    generateContent: boolean;
    timing?: string;
    scheduledDate?: string;
    scheduledHour?: number;
    scheduledMinute?: number;
}
export interface MediationSession {
    initiatorJid: string;
    initiatorName: string;
    recipientJid: string;
    recipientName: string;
    lastActivity: number;
}
