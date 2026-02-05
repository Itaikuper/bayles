import { Router, Request, Response, NextFunction } from 'express';
import { SchedulerService } from '../../services/scheduler.service.js';
import { ScheduleRepository } from '../../database/repositories/schedule.repository.js';

/**
 * Convert time (HH:MM) + days array to a cron expression
 */
function timeToCron(time: string, days?: number[]): string {
  const [hour, minute] = time.split(':').map(Number);
  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('Invalid time format. Use HH:MM (e.g., "06:45")');
  }
  const daysPart = days && days.length > 0 && days.length < 7
    ? days.join(',')
    : '*';
  return `${minute} ${hour} * * ${daysPart}`;
}

export function createSchedulerRoutes(scheduler: SchedulerService): Router {
  const router = Router();
  const scheduleRepo = new ScheduleRepository();

  // List all scheduled messages (with DB fallback)
  router.get('/', (req: Request, res: Response) => {
    const inMemory = scheduler.listScheduledMessages();
    if (inMemory.length > 0) {
      return res.json(inMemory);
    }
    // Fallback: show from DB if memory is empty (e.g. after failed restore)
    const fromDb = scheduleRepo.findAllActive();
    res.json(fromDb.map(s => ({
      id: s.id,
      jid: s.jid,
      message: s.message,
      cronExpression: s.cron_expression,
      oneTime: s.one_time === 1,
      useAi: s.use_ai === 1,
    })));
  });

  // Create scheduled message (recurring)
  router.post('/', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { jid, message, time, days, cronExpression, oneTime = false, useAi = false } = req.body;

      if (!jid || !message) {
        return res.status(400).json({ error: 'Missing required fields: jid, message' });
      }

      // Support both new (time+days) and legacy (cronExpression) formats
      let cron: string;
      if (time) {
        cron = timeToCron(time, days);
      } else if (cronExpression) {
        cron = cronExpression;
      } else {
        return res.status(400).json({ error: 'Missing required field: time (HH:MM) or cronExpression' });
      }

      const id = scheduler.scheduleMessage(jid, message, cron, oneTime, useAi);

      // Persist to database
      scheduleRepo.create({
        id,
        jid,
        message,
        cronExpression: cron,
        oneTime,
        useAi,
      });

      res.status(201).json({ id, jid, message, cronExpression: cron, oneTime, useAi });
    } catch (error) {
      next(error);
    }
  });

  // Schedule one-time message
  router.post('/one-time', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { jid, message, datetime, useAi = false } = req.body;

      if (!jid || !message || !datetime) {
        return res.status(400).json({ error: 'Missing required fields: jid, message, datetime' });
      }

      const date = new Date(datetime);
      if (date <= new Date()) {
        return res.status(400).json({ error: 'Datetime must be in the future' });
      }

      const id = scheduler.scheduleOneTimeMessage(jid, message, date, useAi);

      // Persist to database
      scheduleRepo.create({
        id,
        jid,
        message,
        cronExpression: `one-time`,
        oneTime: true,
        scheduledAt: datetime,
        useAi,
      });

      res.status(201).json({ id, jid, message, datetime, useAi });
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
