import { Router } from 'express';
import { MessageRepository } from '../../database/repositories/message.repository.js';
export function createMessagesRoutes(whatsapp) {
    const router = Router();
    const messageRepo = new MessageRepository();
    // Get message history
    router.get('/', (req, res) => {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const jid = req.query.jid;
        const offset = (page - 1) * limit;
        let messages;
        if (jid) {
            messages = messageRepo.findByJid(jid, limit, offset);
        }
        else {
            messages = messageRepo.findAll(limit, offset);
        }
        res.json(messages);
    });
    // Send message
    router.post('/send', async (req, res, next) => {
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
        }
        catch (error) {
            next(error);
        }
    });
    return router;
}
