import { Router, Request, Response, NextFunction } from 'express';
import { BirthdayService } from '../../services/birthday.service.js';
import { BirthdayRepository } from '../../database/repositories/birthday.repository.js';

export function createBirthdaysRoutes(birthdayService: BirthdayService): Router {
  const router = Router();
  const birthdayRepo = new BirthdayRepository();

  // Get all birthdays
  router.get('/', (req: Request, res: Response) => {
    const birthdays = birthdayRepo.getAll();
    res.json(birthdays);
  });

  // Get birthdays for a specific JID
  router.get('/by-jid/:jid', (req: Request, res: Response) => {
    const jid = decodeURIComponent(req.params.jid as string);
    const birthdays = birthdayRepo.findByJid(jid);
    res.json(birthdays);
  });

  // AI parse a text list and add
  router.post('/parse', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { jid, text } = req.body;

      if (!jid || !text) {
        return res.status(400).json({ error: 'Missing required fields: jid, text' });
      }

      const parsed = await birthdayService.parseBirthdayList(jid, text);
      const ids = birthdayService.addBirthdays(parsed);

      res.status(201).json({ success: true, count: ids.length, birthdays: parsed });
    } catch (error) {
      next(error);
    }
  });

  // Manually add a single birthday
  router.post('/', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { jid, person_name, birth_day, birth_month, custom_message } = req.body;

      if (!jid || !person_name || !birth_day || !birth_month) {
        return res.status(400).json({
          error: 'Missing required fields: jid, person_name, birth_day, birth_month',
        });
      }

      const id = birthdayRepo.create({
        jid,
        person_name,
        birth_day: parseInt(birth_day),
        birth_month: parseInt(birth_month),
        custom_message,
      });

      const birthday = birthdayRepo.findById(id);
      res.status(201).json(birthday);
    } catch (error) {
      next(error);
    }
  });

  // Delete a birthday
  router.delete('/:id', (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    const deleted = birthdayRepo.delete(id);

    if (deleted) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Birthday not found' });
    }
  });

  // Manually trigger birthday check (for testing)
  router.post('/check-now', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await birthdayService.checkAndSendBirthdays();
      res.json({ success: true, message: 'Birthday check completed' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
