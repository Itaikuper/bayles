import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  proto,
  fetchLatestBaileysVersion,
  downloadContentFromMessage,
  normalizeMessageContent,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

export class WhatsAppService {
  private sock: WASocket | null = null;
  private messageHandler: ((message: proto.IWebMessageInfo) => Promise<void>) | null = null;
  private processedMessages: Set<string> = new Set();
  private recentMessages: Map<string, number> = new Map();
  private processingJids: Set<string> = new Set(); // Per-JID lock
  private cleanupEvProcess: (() => void) | null = null;
  private readonly MAX_PROCESSED_CACHE = 1000;
  private readonly DEDUP_WINDOW_MS = 10_000;
  private isConnecting: boolean = false;
  private connectionGeneration: number = 0;
  private onConnectedCallback: (() => Promise<void>) | null = null;
  private onGroupParticipantsUpdateCallback: ((groupJid: string, participants: string[], action: string) => Promise<void>) | null = null;
  private onContactsUpdateCallback: ((contacts: { id: string; notify?: string }[]) => void) | null = null;

  async connect(): Promise<WASocket> {
    if (this.isConnecting) {
      logger.warn('Connection attempt already in progress, skipping');
      return this.sock!;
    }
    this.isConnecting = true;
    this.connectionGeneration++;
    const myGeneration = this.connectionGeneration;

    try {
      const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
      const { version } = await fetchLatestBaileysVersion();

      logger.info(`Baileys v${version.join('.')} | WhatsApp service v3 (ev.process + jid-lock)`);

      // Clean up old socket before creating new one
      if (this.sock) {
        logger.info('Cleaning up previous socket before reconnection');
        try {
          if (this.cleanupEvProcess) {
            this.cleanupEvProcess();
            this.cleanupEvProcess = null;
          }
          this.sock.ev.removeAllListeners('connection.update');
          this.sock.ev.removeAllListeners('creds.update');
          this.sock.ev.removeAllListeners('messages.upsert');
        } catch (cleanupError) {
          logger.warn('Error during socket cleanup:', cleanupError);
        }
        this.sock = null;
      }

      this.sock = makeWASocket({
        auth: state,
        version,
        browser: ['Bayles Bot', 'Chrome', '1.0.0'],
        syncFullHistory: false,
      });

      // Use ev.process for batched event handling (Baileys best practice)
      // Events are batched and processed in a single serialized callback
      this.cleanupEvProcess = this.sock.ev.process(async (events) => {
        // Ignore events from stale sockets
        if (myGeneration !== this.connectionGeneration) return;

        // --- Connection updates ---
        if (events['connection.update']) {
          const { connection, lastDisconnect, qr } = events['connection.update'];

          if (qr) {
            logger.info('QR Code generated - scan with WhatsApp:');
            qrcode.generate(qr, { small: true });
          }

          if (connection === 'close') {
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            logger.warn(`Connection closed. Status: ${statusCode}. Reconnecting: ${shouldReconnect}`);

            if (shouldReconnect) {
              await this.connect();
            } else {
              logger.error('Logged out. Please delete auth_info folder and restart.');
              process.exit(1);
            }
          }

          if (connection === 'open') {
            logger.info('Connected to WhatsApp successfully!');
            if (this.onConnectedCallback) {
              this.onConnectedCallback().catch(err => logger.error('onConnected callback error:', err));
            }
          }
        }

        // --- Credentials ---
        if (events['creds.update']) {
          await saveCreds();
        }

        // --- Group participants update ---
        if (events['group-participants.update']) {
          const update = events['group-participants.update'] as { id: string; participants: string[]; action: string };
          if (this.onGroupParticipantsUpdateCallback) {
            this.onGroupParticipantsUpdateCallback(update.id, update.participants, update.action)
              .catch(err => logger.error('Group participants update callback error:', err));
          }
        }

        // --- Contacts update (provides display names for LID contacts) ---
        if (events['contacts.upsert']) {
          const contacts = events['contacts.upsert'] as { id: string; notify?: string; name?: string }[];
          logger.info(`DEBUG contacts.upsert: ${JSON.stringify(contacts.map(c => ({ id: c.id, notify: c.notify, name: c.name })))}`);
          if (this.onContactsUpdateCallback) {
            this.onContactsUpdateCallback(contacts.map(c => ({ id: c.id, notify: c.notify || c.name })));
          }
        }
        if (events['contacts.update']) {
          const contacts = events['contacts.update'] as { id: string; notify?: string; name?: string }[];
          logger.info(`DEBUG contacts.update: ${JSON.stringify(contacts.map(c => ({ id: c.id, notify: c.notify, name: c.name })))}`);
          if (this.onContactsUpdateCallback) {
            this.onContactsUpdateCallback(contacts.map(c => ({ id: c.id, notify: c.notify || c.name })));
          }
        }

        // --- Incoming messages ---
        if (events['messages.upsert']) {
          const { messages, type } = events['messages.upsert'];
          if (type !== 'notify') return;

          for (const rawMessage of messages) {
            if (rawMessage.key.fromMe) continue;

            // Normalize: unwrap ephemeral, viewOnce, documentWithCaption wrappers
            const normalizedContent = normalizeMessageContent(rawMessage.message);
            const message = normalizedContent !== rawMessage.message
              ? { ...rawMessage, message: normalizedContent } as proto.IWebMessageInfo
              : rawMessage;

            const msgId = message.key.id;
            const jid = message.key.remoteJid || '';
            const text = message.message?.conversation
              || message.message?.extendedTextMessage?.text
              || message.message?.imageMessage?.caption
              || message.message?.documentMessage?.caption
              || '';

            // Layer 1: Message ID dedup
            if (msgId && this.processedMessages.has(msgId)) {
              logger.info(`[dedup:id] Skip ${msgId}`);
              continue;
            }
            if (msgId) {
              this.processedMessages.add(msgId);
              if (this.processedMessages.size > this.MAX_PROCESSED_CACHE) {
                const first = this.processedMessages.values().next().value;
                if (first) this.processedMessages.delete(first);
              }
            }

            // Layer 2: Text-based dedup (10s window, JID-agnostic for DMs)
            const isDM = !jid.endsWith('@g.us');
            const dedupKey = isDM ? `dm:${text}` : `${jid}:${text}`;
            const now = Date.now();
            const lastSeen = this.recentMessages.get(dedupKey);
            if (lastSeen && now - lastSeen < this.DEDUP_WINDOW_MS) {
              logger.info(`[dedup:text] Skip ${msgId} (same text within ${this.DEDUP_WINDOW_MS}ms)`);
              continue;
            }
            if (text) {
              this.recentMessages.set(dedupKey, now);
              for (const [key, ts] of this.recentMessages) {
                if (now - ts > this.DEDUP_WINDOW_MS) this.recentMessages.delete(key);
              }
            }

            // Layer 3: Per-JID processing lock
            if (this.processingJids.has(jid)) {
              logger.info(`[dedup:lock] Skip ${msgId} - already processing for ${jid}`);
              continue;
            }

            this.processingJids.add(jid);
            try {
              if (this.messageHandler) {
                await this.messageHandler(message);
              }
            } finally {
              this.processingJids.delete(jid);
            }
          }
        }
      });

      return this.sock;
    } finally {
      this.isConnecting = false;
    }
  }

  onMessage(handler: (message: proto.IWebMessageInfo) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async sendTextMessage(jid: string, text: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp not connected');
    await this.sock.sendMessage(jid, { text });
    logger.info(`Sent message to ${jid}`);
  }

  async sendImage(
    jid: string,
    imagePath: string,
    caption?: string
  ): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp not connected');
    await this.sock.sendMessage(jid, {
      image: { url: imagePath },
      caption: caption || '',
    });
    logger.info(`Sent image to ${jid}`);
  }

  async sendDocument(
    jid: string,
    filePath: string,
    fileName: string
  ): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp not connected');
    const mimeType = this.getMimeType(filePath);
    await this.sock.sendMessage(jid, {
      document: { url: filePath },
      mimetype: mimeType,
      fileName: fileName,
    });
    logger.info(`Sent document to ${jid}`);
  }

  async sendImageReply(
    jid: string,
    imageBuffer: Buffer,
    caption: string,
    quotedMessage: proto.IWebMessageInfo
  ): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp not connected');
    await this.sock.sendMessage(jid, {
      image: imageBuffer,
      caption: caption || '',
    }, { quoted: quotedMessage });
    logger.info(`Sent image reply to ${jid}`);
  }

  async sendImageBuffer(
    jid: string,
    imageBuffer: Buffer,
    caption?: string
  ): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp not connected');
    await this.sock.sendMessage(jid, {
      image: imageBuffer,
      caption: caption || '',
    });
    logger.info(`Sent image to ${jid}`);
  }

  async sendReply(
    jid: string,
    text: string,
    quotedMessage: proto.IWebMessageInfo
  ): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp not connected');
    await this.sock.sendMessage(jid, { text }, { quoted: quotedMessage });
    logger.info(`Sent reply to ${jid}`);
  }

  async sendVoiceReply(
    jid: string,
    audioBuffer: Buffer,
    quotedMessage: proto.IWebMessageInfo
  ): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp not connected');
    await this.sock.sendMessage(jid, {
      audio: audioBuffer,
      ptt: true,
      mimetype: 'audio/ogg; codecs=opus',
    }, { quoted: quotedMessage });
    logger.info(`Sent voice reply to ${jid}`);
  }

  async getGroups(): Promise<{ id: string; name: string }[]> {
    if (!this.sock) throw new Error('WhatsApp not connected');
    const groups = await this.sock.groupFetchAllParticipating();
    return Object.values(groups).map((group) => ({
      id: group.id,
      name: group.subject,
    }));
  }

  async downloadAudio(audioMessage: proto.Message.IAudioMessage): Promise<Buffer> {
    const stream = await downloadContentFromMessage(
      audioMessage as any,
      'audio'
    );
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async downloadImage(imageMessage: proto.Message.IImageMessage): Promise<Buffer> {
    const stream = await downloadContentFromMessage(
      imageMessage as any,
      'image'
    );
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async downloadDocument(documentMessage: proto.Message.IDocumentMessage): Promise<Buffer> {
    const stream = await downloadContentFromMessage(
      documentMessage as any,
      'document'
    );
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  private getMimeType(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      txt: 'text/plain',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      mp4: 'video/mp4',
      mp3: 'audio/mpeg',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  onConnected(callback: () => Promise<void>): void {
    this.onConnectedCallback = callback;
  }

  onGroupParticipantsUpdate(callback: (groupJid: string, participants: string[], action: string) => Promise<void>): void {
    this.onGroupParticipantsUpdateCallback = callback;
  }

  onContactsUpdate(callback: (contacts: { id: string; notify?: string }[]) => void): void {
    this.onContactsUpdateCallback = callback;
  }

  async findGroupByName(name: string): Promise<string | null> {
    if (!this.sock) return null;
    const groups = await this.sock.groupFetchAllParticipating();
    for (const group of Object.values(groups)) {
      if (group.subject === name) return group.id;
    }
    return null;
  }

  async getGroupParticipants(groupJid: string): Promise<{ id: string; admin?: string | null }[]> {
    if (!this.sock) throw new Error('WhatsApp not connected');
    const metadata = await this.sock.groupMetadata(groupJid);
    return metadata.participants;
  }

  getSocket(): WASocket | null {
    return this.sock;
  }

  getBotJid(): string | null {
    if (!this.sock?.user?.id) return null;
    return this.sock.user.id.replace(/:.*@/, '@');
  }

  getBotLid(): string | null {
    const user = this.sock?.user as { lid?: string } | undefined;
    if (!user?.lid) return null;
    return user.lid.replace(/:.*@/, '@');
  }
}
