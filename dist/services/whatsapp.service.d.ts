import { WASocket, proto } from '@whiskeysockets/baileys';
export declare class WhatsAppService {
    private sock;
    private messageHandler;
    private processedMessages;
    private recentMessages;
    private processingJids;
    private cleanupEvProcess;
    private readonly MAX_PROCESSED_CACHE;
    private readonly DEDUP_WINDOW_MS;
    private isConnecting;
    private connectionGeneration;
    private onConnectedCallback;
    private onGroupParticipantsUpdateCallback;
    private onContactsUpdateCallback;
    connect(): Promise<WASocket>;
    onMessage(handler: (message: proto.IWebMessageInfo) => Promise<void>): void;
    sendTextMessage(jid: string, text: string): Promise<void>;
    sendImage(jid: string, imagePath: string, caption?: string): Promise<void>;
    sendDocument(jid: string, filePath: string, fileName: string): Promise<void>;
    sendImageReply(jid: string, imageBuffer: Buffer, caption: string, quotedMessage: proto.IWebMessageInfo): Promise<void>;
    sendReply(jid: string, text: string, quotedMessage: proto.IWebMessageInfo): Promise<void>;
    sendVoiceReply(jid: string, audioBuffer: Buffer, quotedMessage: proto.IWebMessageInfo): Promise<void>;
    getGroups(): Promise<{
        id: string;
        name: string;
    }[]>;
    downloadAudio(audioMessage: proto.Message.IAudioMessage): Promise<Buffer>;
    downloadImage(imageMessage: proto.Message.IImageMessage): Promise<Buffer>;
    downloadDocument(documentMessage: proto.Message.IDocumentMessage): Promise<Buffer>;
    private getMimeType;
    onConnected(callback: () => Promise<void>): void;
    onGroupParticipantsUpdate(callback: (groupJid: string, participants: string[], action: string) => Promise<void>): void;
    onContactsUpdate(callback: (contacts: {
        id: string;
        notify?: string;
    }[]) => void): void;
    findGroupByName(name: string): Promise<string | null>;
    getGroupParticipants(groupJid: string): Promise<{
        id: string;
        admin?: string | null;
    }[]>;
    getSocket(): WASocket | null;
    getBotJid(): string | null;
    getBotLid(): string | null;
}
