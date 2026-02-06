import { Router } from 'express';
import { WhatsAppService } from '../../services/whatsapp.service.js';
import { GeminiService } from '../../services/gemini.service.js';
import { SchedulerService } from '../../services/scheduler.service.js';
import { BotControlService } from '../../services/bot-control.service.js';
import { BirthdayService } from '../../services/birthday.service.js';
import { createGroupsRoutes } from './groups.routes.js';
import { createSchedulerRoutes } from './scheduler.routes.js';
import { createMessagesRoutes } from './messages.routes.js';
import { createAiRoutes } from './ai.routes.js';
import { createStatsRoutes } from './stats.routes.js';
import { createBotControlRoutes } from './bot-control.routes.js';
import { createBirthdaysRoutes } from './birthdays.routes.js';
import { createKnowledgeRoutes } from './knowledge.routes.js';
import { createTenantsRoutes } from './tenants.routes.js';

export function createRoutes(
  whatsapp: WhatsAppService,
  gemini: GeminiService,
  scheduler: SchedulerService,
  botControl: BotControlService,
  birthdayService: BirthdayService
): Router {
  const router = Router();

  router.use('/groups', createGroupsRoutes(whatsapp));
  router.use('/scheduler', createSchedulerRoutes(scheduler));
  router.use('/messages', createMessagesRoutes(whatsapp));
  router.use('/ai', createAiRoutes(gemini));
  router.use('/stats', createStatsRoutes(whatsapp, gemini, scheduler));
  router.use('/bot-control', createBotControlRoutes(botControl, whatsapp));
  router.use('/birthdays', createBirthdaysRoutes(birthdayService));
  router.use('/knowledge', createKnowledgeRoutes());
  router.use('/tenants', createTenantsRoutes());

  return router;
}
