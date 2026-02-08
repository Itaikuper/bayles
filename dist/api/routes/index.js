import { Router } from 'express';
import { createGroupsRoutes } from './groups.routes.js';
import { createSchedulerRoutes } from './scheduler.routes.js';
import { createMessagesRoutes } from './messages.routes.js';
import { createAiRoutes } from './ai.routes.js';
import { createStatsRoutes } from './stats.routes.js';
import { createBotControlRoutes } from './bot-control.routes.js';
import { createBirthdaysRoutes } from './birthdays.routes.js';
import { createKnowledgeRoutes } from './knowledge.routes.js';
import { createTenantsRoutes } from './tenants.routes.js';
import { createContactsRoutes } from './contacts.routes.js';
import { createSongsRoutes } from './songs.routes.js';
export function createRoutes(whatsapp, gemini, scheduler, botControl, birthdayService) {
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
    router.use('/contacts', createContactsRoutes());
    router.use('/songs', createSongsRoutes());
    return router;
}
