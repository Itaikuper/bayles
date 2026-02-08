import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, downloadContentFromMessage, normalizeMessageContent, } from '@whiskeysockets/baileys';
import path from 'path';
import fs from 'fs';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getTenantRepository } from '../database/repositories/tenant.repository.js';
export class WhatsAppPoolService {
    connections = new Map();
    messageHandler = null;
    MAX_PROCESSED_CACHE = 1000;
    DEDUP_WINDOW_MS = 10_000;
    tenantRepo = getTenantRepository();
    getAuthDir(tenantId) {
        const baseDir = config.authDir || './auth_info';
        return path.join(baseDir, tenantId);
    }
    ensureAuthDir(tenantId) {
        const authDir = this.getAuthDir(tenantId);
        if (!fs.existsSync(authDir)) {
            fs.mkdirSync(authDir, { recursive: true });
        }
    }
    getOrCreateConnection(tenantId) {
        let conn = this.connections.get(tenantId);
        if (!conn) {
            conn = {
                socket: null,
                qrCode: null,
                generation: 0,
                cleanupEvProcess: null,
                isConnecting: false,
                processedMessages: new Set(),
                recentMessages: new Map(),
                processingJids: new Set(),
            };
            this.connections.set(tenantId, conn);
        }
        return conn;
    }
    async connect(tenantId) {
        const conn = this.getOrCreateConnection(tenantId);
        if (conn.isConnecting) {
            logger.warn(`[${tenantId}] Connection attempt already in progress, skipping`);
            return conn.socket;
        }
        conn.isConnecting = true;
        conn.generation++;
        const myGeneration = conn.generation;
        try {
            this.ensureAuthDir(tenantId);
            const authDir = this.getAuthDir(tenantId);
            const { state, saveCreds } = await useMultiFileAuthState(authDir);
            const { version } = await fetchLatestBaileysVersion();
            logger.info(`[${tenantId}] Baileys v${version.join('.')} | Connecting...`);
            // Clean up old socket
            if (conn.socket) {
                logger.info(`[${tenantId}] Cleaning up previous socket`);
                try {
                    if (conn.cleanupEvProcess) {
                        conn.cleanupEvProcess();
                        conn.cleanupEvProcess = null;
                    }
                    conn.socket.ev.removeAllListeners('connection.update');
                    conn.socket.ev.removeAllListeners('creds.update');
                    conn.socket.ev.removeAllListeners('messages.upsert');
                }
                catch (cleanupError) {
                    logger.warn(`[${tenantId}] Error during socket cleanup:`, cleanupError);
                }
                conn.socket = null;
            }
            conn.socket = makeWASocket({
                auth: state,
                version,
                browser: ['Bayles Bot', 'Chrome', '1.0.0'],
                syncFullHistory: false,
            });
            // Use ev.process for batched event handling
            conn.cleanupEvProcess = conn.socket.ev.process(async (events) => {
                // Ignore events from stale sockets
                if (myGeneration !== conn.generation)
                    return;
                // --- Connection updates ---
                if (events['connection.update']) {
                    const { connection, lastDisconnect, qr } = events['connection.update'];
                    if (qr) {
                        logger.info(`[${tenantId}] QR Code generated`);
                        conn.qrCode = qr;
                        this.tenantRepo.setStatus(tenantId, 'connecting');
                    }
                    if (connection === 'close') {
                        const statusCode = lastDisconnect?.error?.output?.statusCode;
                        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                        logger.warn(`[${tenantId}] Connection closed. Status: ${statusCode}. Reconnecting: ${shouldReconnect}`);
                        conn.qrCode = null;
                        this.tenantRepo.setStatus(tenantId, 'disconnected');
                        if (shouldReconnect) {
                            setTimeout(() => this.connect(tenantId), 3000);
                        }
                        else {
                            logger.error(`[${tenantId}] Logged out. Need to re-authenticate.`);
                        }
                    }
                    if (connection === 'open') {
                        logger.info(`[${tenantId}] Connected to WhatsApp successfully!`);
                        conn.qrCode = null;
                        this.tenantRepo.setStatus(tenantId, 'connected');
                        // Update phone number if available
                        if (conn.socket?.user?.id) {
                            const phone = conn.socket.user.id.split(':')[0];
                            this.tenantRepo.update(tenantId, { phone });
                        }
                    }
                }
                // --- Credentials ---
                if (events['creds.update']) {
                    await saveCreds();
                }
                // --- Incoming messages ---
                if (events['messages.upsert']) {
                    const { messages, type } = events['messages.upsert'];
                    if (type !== 'notify')
                        return;
                    for (const rawMessage of messages) {
                        if (rawMessage.key.fromMe)
                            continue;
                        // Normalize message
                        const normalizedContent = normalizeMessageContent(rawMessage.message);
                        const message = normalizedContent !== rawMessage.message
                            ? { ...rawMessage, message: normalizedContent }
                            : rawMessage;
                        const msgId = message.key.id;
                        const jid = message.key.remoteJid || '';
                        const text = message.message?.conversation
                            || message.message?.extendedTextMessage?.text
                            || message.message?.imageMessage?.caption
                            || message.message?.documentMessage?.caption
                            || '';
                        // Layer 1: Message ID dedup
                        if (msgId && conn.processedMessages.has(msgId)) {
                            logger.info(`[${tenantId}][dedup:id] Skip ${msgId}`);
                            continue;
                        }
                        if (msgId) {
                            conn.processedMessages.add(msgId);
                            if (conn.processedMessages.size > this.MAX_PROCESSED_CACHE) {
                                const first = conn.processedMessages.values().next().value;
                                if (first)
                                    conn.processedMessages.delete(first);
                            }
                        }
                        // Layer 2: Text-based dedup (10s window)
                        const isDM = !jid.endsWith('@g.us');
                        const dedupKey = isDM ? `dm:${text}` : `${jid}:${text}`;
                        const now = Date.now();
                        const lastSeen = conn.recentMessages.get(dedupKey);
                        if (lastSeen && now - lastSeen < this.DEDUP_WINDOW_MS) {
                            logger.info(`[${tenantId}][dedup:text] Skip ${msgId}`);
                            continue;
                        }
                        if (text) {
                            conn.recentMessages.set(dedupKey, now);
                            for (const [key, ts] of conn.recentMessages) {
                                if (now - ts > this.DEDUP_WINDOW_MS)
                                    conn.recentMessages.delete(key);
                            }
                        }
                        // Layer 3: Per-JID processing lock
                        if (conn.processingJids.has(jid)) {
                            logger.info(`[${tenantId}][dedup:lock] Skip ${msgId} - already processing for ${jid}`);
                            continue;
                        }
                        conn.processingJids.add(jid);
                        try {
                            if (this.messageHandler) {
                                await this.messageHandler(tenantId, message);
                            }
                        }
                        finally {
                            conn.processingJids.delete(jid);
                        }
                    }
                }
            });
            return conn.socket;
        }
        finally {
            conn.isConnecting = false;
        }
    }
    async disconnect(tenantId) {
        const conn = this.connections.get(tenantId);
        if (!conn || !conn.socket)
            return;
        logger.info(`[${tenantId}] Disconnecting...`);
        if (conn.cleanupEvProcess) {
            conn.cleanupEvProcess();
            conn.cleanupEvProcess = null;
        }
        try {
            conn.socket.end(undefined);
        }
        catch (err) {
            logger.warn(`[${tenantId}] Error ending socket:`, err);
        }
        conn.socket = null;
        conn.qrCode = null;
        this.tenantRepo.setStatus(tenantId, 'disconnected');
    }
    getSocket(tenantId) {
        return this.connections.get(tenantId)?.socket || null;
    }
    getQRCode(tenantId) {
        return this.connections.get(tenantId)?.qrCode || null;
    }
    getStatus(tenantId) {
        const conn = this.connections.get(tenantId);
        if (!conn || !conn.socket)
            return 'disconnected';
        if (conn.qrCode)
            return 'connecting';
        if (conn.socket.user)
            return 'connected';
        return 'disconnected';
    }
    isConnected(tenantId) {
        const conn = this.connections.get(tenantId);
        return !!conn?.socket?.user;
    }
    onMessage(handler) {
        this.messageHandler = handler;
    }
    async sendTextMessage(tenantId, jid, text) {
        const sock = this.getSocket(tenantId);
        if (!sock)
            throw new Error(`Tenant ${tenantId} not connected`);
        await sock.sendMessage(jid, { text });
        logger.info(`[${tenantId}] Sent message to ${jid}`);
    }
    async sendReply(tenantId, jid, text, quotedMessage) {
        const sock = this.getSocket(tenantId);
        if (!sock)
            throw new Error(`Tenant ${tenantId} not connected`);
        await sock.sendMessage(jid, { text }, { quoted: quotedMessage });
        logger.info(`[${tenantId}] Sent reply to ${jid}`);
    }
    async sendImage(tenantId, jid, imagePath, caption) {
        const sock = this.getSocket(tenantId);
        if (!sock)
            throw new Error(`Tenant ${tenantId} not connected`);
        await sock.sendMessage(jid, {
            image: { url: imagePath },
            caption: caption || '',
        });
        logger.info(`[${tenantId}] Sent image to ${jid}`);
    }
    async sendImageReply(tenantId, jid, imageBuffer, caption, quotedMessage) {
        const sock = this.getSocket(tenantId);
        if (!sock)
            throw new Error(`Tenant ${tenantId} not connected`);
        await sock.sendMessage(jid, {
            image: imageBuffer,
            caption: caption || '',
        }, { quoted: quotedMessage });
        logger.info(`[${tenantId}] Sent image reply to ${jid}`);
    }
    async sendVoiceReply(tenantId, jid, audioBuffer, quotedMessage) {
        const sock = this.getSocket(tenantId);
        if (!sock)
            throw new Error(`Tenant ${tenantId} not connected`);
        await sock.sendMessage(jid, {
            audio: audioBuffer,
            ptt: true,
            mimetype: 'audio/ogg; codecs=opus',
        }, { quoted: quotedMessage });
        logger.info(`[${tenantId}] Sent voice reply to ${jid}`);
    }
    async downloadAudio(audioMessage) {
        const stream = await downloadContentFromMessage(audioMessage, 'audio');
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }
    async downloadImage(imageMessage) {
        const stream = await downloadContentFromMessage(imageMessage, 'image');
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }
    async downloadDocument(documentMessage) {
        const stream = await downloadContentFromMessage(documentMessage, 'document');
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }
    async getGroups(tenantId) {
        const sock = this.getSocket(tenantId);
        if (!sock)
            throw new Error(`Tenant ${tenantId} not connected`);
        const groups = await sock.groupFetchAllParticipating();
        return Object.values(groups).map((group) => ({
            id: group.id,
            name: group.subject,
        }));
    }
    getBotJid(tenantId) {
        const sock = this.getSocket(tenantId);
        if (!sock?.user?.id)
            return null;
        return sock.user.id.replace(/:.*@/, '@');
    }
    getAllConnectedTenants() {
        const connected = [];
        for (const [tenantId, conn] of this.connections) {
            if (conn.socket?.user) {
                connected.push(tenantId);
            }
        }
        return connected;
    }
    async connectAllActive() {
        const tenants = this.tenantRepo.getAll();
        for (const tenant of tenants) {
            // Skip 'default' tenant - managed by WhatsAppService
            if (tenant.id === 'default')
                continue;
            if (tenant.status !== 'disconnected') {
                try {
                    await this.connect(tenant.id);
                }
                catch (err) {
                    logger.error(`[${tenant.id}] Failed to connect:`, err);
                }
            }
        }
    }
    async disconnectAll() {
        for (const tenantId of this.connections.keys()) {
            await this.disconnect(tenantId);
        }
    }
}
let poolInstance = null;
export function getWhatsAppPool() {
    if (!poolInstance) {
        poolInstance = new WhatsAppPoolService();
    }
    return poolInstance;
}
