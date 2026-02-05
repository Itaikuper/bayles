import { WhatsAppService } from './services/whatsapp.service.js';
import { GeminiService } from './services/gemini.service.js';
import { SchedulerService } from './services/scheduler.service.js';
import { BirthdayService } from './services/birthday.service.js';
import { getBotControlService } from './services/bot-control.service.js';
import { MessageHandler } from './handlers/message.handler.js';
import { validateConfig, config } from './config/env.js';
import { logger } from './utils/logger.js';
import { createApiServer, startApiServer } from './api/server.js';
import { runMigrations } from './database/migrate.js';
import { closeDatabase } from './database/db.js';

async function main() {
  try {
    // Validate configuration
    validateConfig();
    logger.info('Configuration validated');

    // Run database migrations
    runMigrations();

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

    // Initialize bot control service
    const botControl = getBotControlService();

    // Initialize message handler
    const messageHandler = new MessageHandler(whatsapp, gemini, scheduler, botControl, birthdayService);

    // Register message handler (async - awaited by WhatsApp service for serialized processing)
    whatsapp.onMessage(async (message) => {
      try {
        await messageHandler.handle(message);
      } catch (err) {
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

    // Handle graceful shutdown
    const shutdown = () => {
      logger.info('Shutting down...');
      scheduler.cancelAll();
      birthdayService.stop();
      closeDatabase();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep process alive
    process.stdin.resume();
  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

main();
