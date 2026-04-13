import type { GeminiResponse } from '../types/index.js';
export declare class GeminiService {
    private ai;
    private conversationHistory;
    private maxHistoryLength;
    constructor();
    private getImageInstructions;
    /**
     * Returns the assistant mode for a given chat. Owner DM gets a focused personal-assistant prompt
     * with eager tool use and no image auto-generation. Default chats keep current behavior.
     */
    isOwnerMode(jid: string, senderJid?: string): boolean;
    private getAssistantMode;
    generateResponse(jid: string, userMessage: string, customPrompt?: string, tenantId?: string, senderJid?: string): Promise<GeminiResponse>;
    generateAudioResponse(jid: string, audioBuffer: Buffer, mimeType: string, customPrompt?: string, contextPrefix?: string, tenantId?: string, senderJid?: string): Promise<string>;
    transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string>;
    generateDocumentAnalysisResponse(jid: string, mediaBuffer: Buffer, mimeType: string, caption?: string, customPrompt?: string, contextPrefix?: string, fileName?: string, tenantId?: string): Promise<string>;
    generateImage(prompt: string, pro?: boolean): Promise<{
        image: Buffer;
        text?: string;
    } | null>;
    generateSpeech(text: string): Promise<Buffer>;
    private convertPcmToOgg;
    /**
     * Generate content for scheduled messages - NO function calling
     * This prevents AI from re-interpreting prompts as scheduling requests
     */
    generateScheduledContent(prompt: string): Promise<string>;
    /**
     * Resolve a free-form recipient hint ("אסתר", "ליתי קופרס", "esther@...") to an email.
     * Uses the owner's core memory + people notes. Returns null if unknown.
     */
    resolveEmailRecipient(hint: string): Promise<{
        email: string | null;
        label: string | null;
    }>;
    /**
     * Generate the subject + body for a new email draft. Single focused LLM call,
     * structured output. No tool calling — the workflow owns the sequence.
     */
    generateEmailBody(opts: {
        topicHint: string;
        subjectHint?: string;
        recipientLabel?: string | null;
        recipientEmail: string;
        priorThreadSnippets?: string[];
        ownerCoreMemory?: string;
    }): Promise<{
        subject: string;
        body: string;
    }>;
    /**
     * Extract persistent facts about the user from a conversation exchange.
     * Runs asynchronously after sending the AI response - does not block.
     */
    extractUserFacts(senderJid: string, userMessage: string, botResponse: string, tenantId?: string): Promise<void>;
    /**
     * Lazy-load conversation history from DB on first access for a JID.
     * Converts DB rows into the ChatHistory format used by the in-memory cache.
     */
    private loadHistoryFromDb;
    /**
     * Add a user message + bot action summary to conversation history.
     * Used after function calls (send_message, create_schedule, etc.) so the bot
     * remembers what it did when the user asks later.
     */
    addToHistory(jid: string, userMessage: string, actionSummary: string, tenantId?: string): void;
    clearHistory(jid: string, tenantId?: string): void;
    clearAllHistory(): void;
    listConversations(): {
        jid: string;
        messageCount: number;
    }[];
}
