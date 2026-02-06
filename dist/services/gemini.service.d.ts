import type { GeminiResponse } from '../types/index.js';
export declare class GeminiService {
    private ai;
    private conversationHistory;
    private maxHistoryLength;
    constructor();
    private getImageInstructions;
    generateResponse(jid: string, userMessage: string, customPrompt?: string): Promise<GeminiResponse>;
    generateAudioResponse(jid: string, audioBuffer: Buffer, mimeType: string, customPrompt?: string, contextPrefix?: string): Promise<string>;
    generateDocumentAnalysisResponse(jid: string, mediaBuffer: Buffer, mimeType: string, caption?: string, customPrompt?: string, contextPrefix?: string, fileName?: string): Promise<string>;
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
    clearHistory(jid: string): void;
    clearAllHistory(): void;
    listConversations(): {
        jid: string;
        messageCount: number;
    }[];
}
