import { Router, Request, Response, NextFunction } from 'express';
import { SchedulerService } from '../../services/scheduler.service.js';
import { ScheduleRepository } from '../../database/repositories/schedule.repository.js';

export function createSchedulerRoutes(scheduler: SchedulerService): Router {
  const router = Router();
  const scheduleRepo = new ScheduleRepository();

  // List all scheduled messages
  router.get('/', (req: Request, res: Response) => {
    const scheduled = scheduler.listScheduledMessages();
    res.json(scheduled);
  });

  // Create scheduled message with cron
  router.post('/', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { jid, message, cronExpression, oneTime = false } = req.body;

      if (!jid || !message || !cronExpression) {
        return res.status(400).json({ error: 'Missing required fields: jid, message, cronExpression' });
      }

      const id = scheduler.scheduleMessage(jid, message, cronExpression, oneTime);

      // Persist to database
      scheduleRepo.create({
        id,
        jid,
        message,
        cronExpression,
        oneTime,
      });

      res.status(201).json({ id, jid, message, cronExpression, oneTime });
    } catch (error) {
      next(error);
    }
  });

  // Schedule one-time message
  router.post('/one-time', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { jid, message, datetime } = req.body;

      if (!jid || !message || !datetime) {
        return res.status(400).json({ error: 'Missing required fields: jid, message, datetime' });
      }

      const date = new Date(datetime);
      if (date <= new Date()) {
        return res.status(400).json({ error: 'Datetime must be in the future' });
      }

      const id = scheduler.scheduleOneTimeMessage(jid, message, date);

      // Persist to database
      scheduleRepo.create({
        id,
        jid,
        message,
        cronExpression: `one-time`,
        oneTime: true,
        scheduledAt: datetime,
      });

      res.status(201).json({ id, jid, message, datetime });
    } catch (error) {
      next(error);
    }
  });

  // Cancel scheduled message
  router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
    const id = req.params.id;
    const cancelled = scheduler.cancelScheduledMessage(id);

    if (cancelled) {
      scheduleRepo.delete(id);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Scheduled message not found' });
    }
  });

  return router;
}
