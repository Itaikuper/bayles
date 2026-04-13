import { type GmailWatchLabel } from '../database/repositories/gmail.repository.js';
import type { WhatsAppService } from './whatsapp.service.js';
import type { GeminiService } from './gemini.service.js';
export interface EmailSummary {
    id: string;
    threadId: string;
    from: string;
    subject: string;
    date: string;
    snippet: string;
    labelNames: string[];
}
export declare class GmailService {
    private whatsapp;
    private gemini;
    private cronTask;
    private polling;
    constructor(whatsapp: WhatsAppService, gemini: GeminiService);
    start(): Promise<void>;
    stop(): void;
    isOwner(jid: string): boolean;
    private assertOwner;
    private buildOAuthClient;
    getAuthUrl(jid: string): string;
    handleOAuthCallback(code: string, state: string): Promise<{
        email: string;
    }>;
    private getGmailClient;
    pollInbox(): Promise<void>;
    private notifyAboutMessage;
    listRecentEmails(jid: string, opts?: {
        labelName?: string;
        query?: string;
        max?: number;
    }): Promise<EmailSummary[]>;
    readEmail(jid: string, messageId: string): Promise<{
        from: string;
        subject: string;
        date: string;
        body: string;
        threadId: string;
    }>;
    /**
     * Create a fresh (non-reply) draft email. To/Subject/Body only. Never sends.
     */
    createDraftNew(jid: string, to: string, subject: string, body: string): Promise<{
        draftId: string;
    }>;
    /**
     * Create a draft reply. This is a write path. No send. No drafts.send.
     */
    createDraftReply(jid: string, messageId: string, body: string): Promise<{
        draftId: string;
    }>;
    addWatchLabel(jid: string, labelName: string): Promise<{
        ok: boolean;
        reason?: string;
        labelId?: string;
    }>;
    removeWatchLabel(jid: string, labelName: string): Promise<number>;
    listWatchLabels(jid: string): GmailWatchLabel[];
    addWatchSender(jid: string, email: string): void;
    removeWatchSender(jid: string, email: string): number;
    listWatchSenders(jid: string): string[];
    listAllGmailLabels(jid: string): Promise<{
        id: string;
        name: string;
    }[]>;
}
export declare function getGmailServiceInstance(): GmailService | null;
export declare function setGmailServiceInstance(svc: GmailService | null): void;
