import { WASocket, proto } from '@whiskeysockets/baileys';
type MessageHandler = (tenantId: string, message: proto.IWebMessageInfo) => Promise<void>;
export declare class WhatsAppPoolService {
    private connections;
    private messageHandler;
    private readonly MAX_PROCESSED_CACHE;
    private readonly DEDUP_WINDOW_MS;
    private tenantRepo;
    private getAuthDir;
    private ensureAuthDir;
    private getOrCreateConnection;
    connect(tenantId: string): Promise<WASocket>;
    disconnect(tenantId: string): Promise<void>;
    getSocket(tenantId: string): WASocket | null;
    getQRCode(tenantId: string): string | null;
    getStatus(tenantId: string): 'disconnected' | 'connecting' | 'connected';
    isConnected(tenantId: string): boolean;
    onMessage(handler: MessageHandler): void;
    sendTextMessage(tenantId: string, jid: string, text: string): Promise<void>;
    sendReply(tenantId: string, jid: string, text: string, quotedMessage: proto.IWebMessageInfo): Promise<void>;
    sendImage(tenantId: string, jid: string, imagePath: string, caption?: string): Promise<void>;
    sendImageReply(tenantId: string, jid: string, imageBuffer: Buffer, caption: string, quotedMessage: proto.IWebMessageInfo): Promise<void>;
    sendVoiceReply(tenantId: string, jid: string, audioBuffer: Buffer, quotedMessage: proto.IWebMessageInfo): Promise<void>;
    downloadAudio(audioMessage: proto.Message.IAudioMessage): Promise<Buffer>;
    downloadImage(imageMessage: proto.Message.IImageMessage): Promise<Buffer>;
    downloadDocument(documentMessage: proto.Message.IDocumentMessage): Promise<Buffer>;
    getGroups(tenantId: string): Promise<{
        id: string;
        name: string;
    }[]>;
    getBotJid(tenantId: string): string | null;
    getAllConnectedTenants(): string[];
    connectAllActive(): Promise<void>;
}
export declare function getWhatsAppPool(): WhatsAppPoolService;
export {};
