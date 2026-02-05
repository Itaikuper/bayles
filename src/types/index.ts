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
  parts: { text: string }[];
}
