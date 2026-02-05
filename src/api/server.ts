import express, { Express, Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { GeminiService } from '../services/gemini.service.js';
import { SchedulerService } from '../services/scheduler.service.js';
import { BotControlService } from '../services/bot-control.service.js';
import { BirthdayService } from '../services/birthday.service.js';
import { createRoutes } from './routes/index.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApiServer(
  whatsapp: WhatsAppService,
  gemini: GeminiService,
  scheduler: SchedulerService,
  botControl: BotControlService,
  birthdayService: BirthdayService
): Express {
  const app = express();

  // Middleware
  app.use(express.json());

  // CORS for local development
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Serve static files (React dashboard)
  app.use(express.static(path.join(__dirname, '../../web')));

  // API routes - inject services
  app.use('/api', createRoutes(whatsapp, gemini, scheduler, botControl, birthdayService));

  // SPA fallback - serve index.html for non-API routes
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, '../../web/index.html'));
    } else if (req.path.startsWith('/api')) {
      res.status(404).json({ error: 'Not found' });
    } else {
      next();
    }
  });

  // Error handling middleware
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    logger.error('API Error:', err.message);
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

export function startApiServer(app: Express, port: number = 3000): void {
  app.listen(port, () => {
    logger.info(`Dashboard running at http://localhost:${port}`);
  });
}
