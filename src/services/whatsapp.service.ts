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
  private messageHandler: ((message: proto.IWebMessageInfo) => Promise<void>) | null = null;
  private processedMessages: Set<string> = new Set();
  private recentMessages: Map<string, number> = new Map(); // text -> timestamp
  private readonly MAX_PROCESSED_CACHE = 1000;
  private readonly DEDUP_WINDOW_MS = 10_000; // 10 second cooldown per text
  private isConnecting: boolean = false;
  private connectionGeneration: number = 0;

  async connect(): Promise<WASocket> {
    // Guard against concurrent reconnection attempts
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

      logger.info(`Using Baileys version: ${version.join('.')}`);

      // Clean up old socket listeners before creating new one
      if (this.sock) {
        logger.info('Cleaning up previous socket before reconnection');
        try {
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

      // Handle connection updates
      this.sock.ev.on('connection.update', async (update) => {
        // Ignore events from stale sockets
        if (myGeneration !== this.connectionGeneration) {
          logger.info(`Ignoring connection.update from stale socket (gen ${myGeneration}, current ${this.connectionGeneration})`);
          return;
        }

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

        // Ignore events from stale sockets
        if (myGeneration !== this.connectionGeneration) {
          logger.info(`Ignoring messages.upsert from stale socket (gen ${myGeneration}, current ${this.connectionGeneration})`);
          return;
        }

        for (const message of messages) {
          if (message.key.fromMe) continue; // Skip own messages

          // Deduplicate by message ID
          const msgId = message.key.id;
          if (msgId && this.processedMessages.has(msgId)) {
            logger.info(`Skipping duplicate message (same ID): ${msgId}`);
            continue;
          }
          if (msgId) {
            this.processedMessages.add(msgId);
            if (this.processedMessages.size > this.MAX_PROCESSED_CACHE) {
              const first = this.processedMessages.values().next().value;
              if (first) this.processedMessages.delete(first);
            }
          }

          // Deduplicate by text within time window (catches Bad MAC retries with new IDs
          // and same message arriving via different JID formats: phone vs LID)
          const text = message.message?.conversation
            || message.message?.extendedTextMessage?.text
            || message.message?.imageMessage?.caption
            || '';
          const jid = message.key.remoteJid || '';
          // For DMs: use text-only key (same person may appear as different JID formats)
          // For groups: include group JID to avoid cross-group false positives
          const isDM = !jid.endsWith('@g.us');
          const dedupKey = isDM ? `dm:${text}` : `${jid}:${text}`;
          const now = Date.now();
          const lastSeen = this.recentMessages.get(dedupKey);
          if (lastSeen && now - lastSeen < this.DEDUP_WINDOW_MS) {
            logger.info(`Skipping duplicate message (same text within ${this.DEDUP_WINDOW_MS}ms): ${msgId}`);
            continue;
          }
          if (text) {
            this.recentMessages.set(dedupKey, now);
            // Clean old entries
            for (const [key, ts] of this.recentMessages) {
              if (now - ts > this.DEDUP_WINDOW_MS) this.recentMessages.delete(key);
            }
          }

          if (this.messageHandler) {
            await this.messageHandler(message);
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
