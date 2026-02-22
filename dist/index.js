import { WhatsAppService } from './services/whatsapp.service.js';
import { GeminiService } from './services/gemini.service.js';
import { SchedulerService } from './services/scheduler.service.js';
import { BirthdayService } from './services/birthday.service.js';
import { CompactionService } from './services/compaction.service.js';
import { getBotControlService } from './services/bot-control.service.js';
import { MessageHandler } from './handlers/message.handler.js';
import { validateConfig, config } from './config/env.js';
import { logger } from './utils/logger.js';
import { createApiServer, startApiServer } from './api/server.js';
import { runMigrations } from './database/migrate.js';
import { closeDatabase, getDatabase } from './database/db.js';
import { getWhatsAppPool } from './services/whatsapp-pool.service.js';
import { getTenantRepository } from './database/repositories/tenant.repository.js';
import { getKnowledgeRepository } from './database/repositories/knowledge.repository.js';
async function main() {
    try {
        // Validate configuration
        validateConfig();
        logger.info('Configuration validated');
        // Run database migrations
        runMigrations();
        // Load saved system prompt from database (if exists)
        const savedPrompt = getDatabase()
            .prepare('SELECT value FROM ai_settings WHERE key = ?')
            .get('systemPrompt');
        if (savedPrompt?.value) {
            config.systemPrompt = savedPrompt.value;
            logger.info('Loaded system prompt from database');
        }
        // Initialize services
        const whatsapp = new WhatsAppService();
        const gemini = new GeminiService();
        // Connect to WhatsApp
        logger.info('Connecting to WhatsApp...');
        await whatsapp.connect();
        // Initialize scheduler (after WhatsApp connects)
        const scheduler = new SchedulerService(whatsapp, gemini);
        // Restore scheduled messages from database
        scheduler.restoreFromDatabase();
        // Initialize birthday service
        const birthdayService = new BirthdayService(whatsapp, gemini);
        birthdayService.start();
        // Initialize conversation compaction service
        const compactionService = new CompactionService(gemini);
        compactionService.start();
        // Initialize bot control service
        const botControl = getBotControlService();
        // Initialize message handler
        const messageHandler = new MessageHandler(whatsapp, gemini, scheduler, botControl, birthdayService);
        // Auto-whitelist family group members (group + private DMs)
        let familyGroupJid = null;
        const syncFamilyGroup = async () => {
            try {
                const groupName = config.familyGroupName;
                if (!groupName)
                    return;
                logger.info(`Syncing family group members: "${groupName}"`);
                familyGroupJid = await whatsapp.findGroupByName(groupName);
                if (!familyGroupJid) {
                    logger.warn(`Family group "${groupName}" not found`);
                    return;
                }
                // Whitelist the group itself
                botControl.ensureChatWhitelisted(familyGroupJid, groupName, true);
                // Whitelist each member for private DMs
                const participants = await whatsapp.getGroupParticipants(familyGroupJid);
                let added = 0;
                for (const p of participants) {
                    if (botControl.ensureChatWhitelisted(p.id))
                        added++;
                }
                logger.info(`Family group sync: ${added} new members whitelisted (${participants.length} total)`);
            }
            catch (error) {
                logger.error('Error syncing family group:', error);
            }
        };
        whatsapp.onConnected(syncFamilyGroup);
        whatsapp.onGroupParticipantsUpdate(async (groupJid, participants, action) => {
            if (action !== 'add')
                return;
            if (!familyGroupJid || groupJid !== familyGroupJid)
                return;
            for (const jid of participants) {
                botControl.ensureChatWhitelisted(jid);
            }
            logger.info(`Auto-whitelisted ${participants.length} new family group member(s)`);
        });
        // Save contact names from Baileys contacts events (fills in LID display names)
        whatsapp.onContactsUpdate((contacts) => {
            for (const contact of contacts) {
                if (contact.notify && contact.id) {
                    const existingConfig = botControl.getChatConfig(contact.id);
                    const nameIsMissing = !existingConfig?.display_name || existingConfig.display_name === contact.id;
                    if (existingConfig && nameIsMissing) {
                        botControl.updateChat(contact.id, { display_name: contact.notify });
                        logger.info(`Saved display_name "${contact.notify}" for ${contact.id} (from contacts event)`);
                    }
                }
            }
        });
        // Register message handler (async - awaited by WhatsApp service for serialized processing)
        whatsapp.onMessage(async (message) => {
            try {
                await messageHandler.handle(message);
            }
            catch (err) {
                logger.error('Message handler error:', err);
            }
        });
        // Start API server (dashboard)
        const apiPort = parseInt(process.env.API_PORT || '3000');
        const app = createApiServer(whatsapp, gemini, scheduler, botControl, birthdayService);
        startApiServer(app, apiPort);
        logger.info('Bot is running!');
        logger.info(`Bot prefix: ${config.botPrefix}`);
        logger.info('Bot is SILENT by default - configure via dashboard');
        logger.info('Scan QR code with WhatsApp to login (if not already authenticated)');
        // === Multi-tenant Pool (for business tenants, separate from default bot) ===
        const pool = getWhatsAppPool();
        const tenantRepo = getTenantRepository();
        const knowledgeRepo = getKnowledgeRepository();
        pool.onMessage(async (tenantId, message) => {
            try {
                const jid = message.key.remoteJid;
                if (!jid)
                    return;
                const tenant = tenantRepo.getById(tenantId);
                if (!tenant)
                    return;
                // Extract text from message
                const text = message.message?.conversation
                    || message.message?.extendedTextMessage?.text
                    || message.message?.imageMessage?.caption
                    || '';
                if (!text)
                    return;
                // Build custom prompt from tenant's system prompt + knowledge base
                const knowledgeText = knowledgeRepo.getFormattedKnowledge(tenantId);
                const customPrompt = (tenant.system_prompt || '') + knowledgeText;
                const response = await gemini.generateResponse(jid, text, customPrompt || undefined, tenantId);
                if (response.text) {
                    await pool.sendReply(tenantId, jid, response.text, message);
                }
            }
            catch (err) {
                logger.error(`[${tenantId}] Tenant message handler error:`, err);
            }
        });
        // Connect all active business tenants (skips 'default')
        pool.connectAllActive().then(() => {
            logger.info('Multi-tenant pool initialized');
        }).catch((err) => {
            logger.error('Error initializing tenant pool:', err);
        });
        // Handle graceful shutdown
        const shutdown = async () => {
            logger.info('Shutting down...');
            scheduler.cancelAll();
            birthdayService.stop();
            compactionService.stop();
            await pool.disconnectAll();
            closeDatabase();
            process.exit(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
        // Keep process alive
        process.stdin.resume();
    }
    catch (error) {
        logger.error('Failed to start bot:', error);
        process.exit(1);
    }
}
main();
