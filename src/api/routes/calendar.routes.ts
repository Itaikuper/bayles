import { Router, Request, Response } from 'express';
import { getCalendarLinkRepository } from '../../database/repositories/calendar-link.repository.js';
import type { CalendarService } from '../../services/calendar.service.js';

export function createCalendarRoutes(calendarService: CalendarService): Router {
  const router = Router();
  const repo = getCalendarLinkRepository();

  // GET /api/calendar/links
  router.get('/links', (req: Request, res: Response) => {
    const links = repo.getAll();
    res.json(links);
  });

  // POST /api/calendar/links
  router.post('/links', (req: Request, res: Response) => {
    const { jid, calendar_id, display_name } = req.body;
    if (!jid || !calendar_id) {
      return res.status(400).json({ error: 'jid and calendar_id are required' });
    }
    try {
      const id = repo.create(jid, calendar_id, display_name);
      res.status(201).json({ id, jid, calendar_id, display_name });
    } catch (err: any) {
      if (err.message?.includes('UNIQUE constraint')) {
        return res.status(409).json({ error: 'This JID is already linked to this calendar' });
      }
      throw err;
    }
  });

  // PUT /api/calendar/links/:id
  router.put('/links/:id', (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const existing = repo.getById(id);
    if (!existing) return res.status(404).json({ error: 'Link not found' });

    const { display_name, is_default, daily_summary } = req.body;
    const updated = repo.update(id, { display_name, is_default, daily_summary });
    if (updated) {
      res.json(repo.getById(id));
    } else {
      res.status(400).json({ error: 'No fields to update' });
    }
  });

  // DELETE /api/calendar/links/:id
  router.delete('/links/:id', (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const deleted = repo.delete(id);
    if (deleted) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Link not found' });
    }
  });

  // GET /api/calendar/events?jid=X&date=YYYY-MM-DD
  router.get('/events', async (req: Request, res: Response) => {
    const jid = req.query.jid as string | undefined;
    const date = req.query.date as string | undefined;
    if (!jid) {
      return res.status(400).json({ error: 'jid query param is required' });
    }

    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    try {
      const events = await calendarService.listEventsForJid(jid, startOfDay, endOfDay);
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch events' });
    }
  });

  // POST /api/calendar/daily-summary
  router.post('/daily-summary', async (req: Request, res: Response) => {
    try {
      await calendarService.sendDailySummaries();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to send daily summaries' });
    }
  });

  return router;
}
