import { Router } from 'express';
import { MessageRepository } from '../../database/repositories/message.repository.js';
import { ScheduleRepository } from '../../database/repositories/schedule.repository.js';
export function createStatsRoutes(whatsapp, _gemini, scheduler) {
    const router = Router();
    const messageRepo = new MessageRepository();
    const scheduleRepo = new ScheduleRepository();
    // Get dashboard stats
    router.get('/', async (req, res, next) => {
        try {
            const isConnected = whatsapp.getSocket() !== null;
            let groupCount = 0;
            if (isConnected) {
                try {
                    const groups = await whatsapp.getGroups();
                    groupCount = groups.length;
                }
                catch {
                    // Ignore errors when fetching groups
                }
            }
            const inMemoryCount = scheduler.listScheduledMessages().length;
            const scheduledCount = inMemoryCount > 0 ? inMemoryCount : scheduleRepo.countActive();
            const messagesSentToday = messageRepo.countToday();
            res.json({
                isConnected,
                groupCount,
                scheduledCount,
                messagesSentToday,
            });
        }
        catch (error) {
            next(error);
        }
    });
    return router;
}
