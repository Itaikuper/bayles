import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  proto,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

export class WhatsAppService {
  private sock: WASocket | null = null;
  private messageHandler: ((message: proto.IWebMessageInfo) => void) | null = null;
  private processedMessages: Set<string> = new Set();
  private readonly MAX_PROCESSED_CACHE = 1000;

  async connect(): Promise<WASocket> {
    const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
    const { version } = await fetchLatestBaileysVersion();

    logger.info(`Using Baileys version: ${version.join('.')}`);

    this.sock = makeWASocket({
      auth: state,
      version,
      browser: ['Bayles Bot', 'Chrome', '1.0.0'],
      syncFullHistory: false,
    });

    // Handle connection updates
    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('QR Code generated - scan with WhatsApp on your phone:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.warn(
          `Connection closed. Status: ${statusCode}. Reconnecting: ${shouldReconnect}`
        );

        if (shouldReconnect) {
          await this.connect();
        } else {
          logger.error('Logged out. Please delete auth_info folder and restart.');
          process.exit(1);
        }
      }

      if (connection === 'open') {
        logger.info('Connected to WhatsApp successfully!');
      }
    });

    // Save credentials on update
    this.sock.ev.on('creds.update', saveCreds);

    // Handle incoming messages
    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const message of messages) {
        if (message.key.fromMe) continue; // Skip own messages

        // Deduplicate - Baileys can fire the same message multiple times
        const msgId = message.key.id;
        if (msgId && this.processedMessages.has(msgId)) {
          logger.info(`Skipping duplicate message: ${msgId}`);
          continue;
        }
        if (msgId) {
          this.processedMessages.add(msgId);
          // Prevent memory leak - trim cache when too large
          if (this.processedMessages.size > this.MAX_PROCESSED_CACHE) {
            const first = this.processedMessages.values().next().value;
            if (first) this.processedMessages.delete(first);
          }
        }

        if (this.messageHandler) {
          this.messageHandler(message);
        }
      }
    });

    return this.sock;
  }

  onMessage(handler: (message: proto.IWebMessageInfo) => void): void {
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

  async sendReply(
    jid: string,
    text: string,
    quotedMessage: proto.IWebMessageInfo
  ): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp not connected');
    await this.sock.sendMessage(jid, { text }, { quoted: quotedMessage });
    logger.info(`Sent reply to ${jid}`);
  }

  async getGroups(): Promise<{ id: string; name: string }[]> {
    if (!this.sock) throw new Error('WhatsApp not connected');
    const groups = await this.sock.groupFetchAllParticipating();
    return Object.values(groups).map((group) => ({
      id: group.id,
      name: group.subject,
    }));
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

  getSocket(): WASocket | null {
    return this.sock;
  }

  getBotJid(): string | null {
    if (!this.sock?.user?.id) return null;
    // Normalize JID format (remove :0 suffix if present)
    return this.sock.user.id.replace(/:.*@/, '@');
  }

  getBotLid(): string | null {
    // Get the LID (Linked Identity) format of the bot's JID
    const user = this.sock?.user as { lid?: string } | undefined;
    if (!user?.lid) return null;
    return user.lid.replace(/:.*@/, '@');
  }
}
