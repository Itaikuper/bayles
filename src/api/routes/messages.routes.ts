import { Router, Request, Response, NextFunction } from 'express';
import { WhatsAppService } from '../../services/whatsapp.service.js';
import { MessageRepository } from '../../database/repositories/message.repository.js';

export function createMessagesRoutes(whatsapp: WhatsAppService): Router {
  const router = Router();
  const messageRepo = new MessageRepository();

  // Get message history
  router.get('/', (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const jid = req.query.jid as string | undefined;
    const offset = (page - 1) * limit;

    let messages;
    if (jid) {
      messages = messageRepo.findByJid(jid, limit, offset);
    } else {
      messages = messageRepo.findAll(limit, offset);
    }

    res.json(messages);
  });

  // Send message
  router.post('/send', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { jid, message } = req.body;

      if (!jid || !message) {
        return res.status(400).json({ error: 'Missing required fields: jid, message' });
      }

      await whatsapp.sendTextMessage(jid, message);

      // Log to database
      messageRepo.create({
        jid,
        direction: 'outgoing',
        message,
        is_group: jid.endsWith('@g.us') ? 1 : 0,
      });

      res.json({ success: true, jid, message });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
