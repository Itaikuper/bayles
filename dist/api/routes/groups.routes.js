import { Router } from 'express';
import { MessageRepository } from '../../database/repositories/message.repository.js';
export function createGroupsRoutes(whatsapp) {
    const router = Router();
    const messageRepo = new MessageRepository();
    // List all groups
    router.get('/', async (req, res, next) => {
        try {
            const groups = await whatsapp.getGroups();
            res.json(groups);
        }
        catch (error) {
            next(error);
        }
    });
    // Send message to group
    router.post('/:id/send', async (req, res, next) => {
        try {
            const id = req.params.id;
            const { message } = req.body;
            if (!message) {
                return res.status(400).json({ error: 'Message is required' });
            }
            await whatsapp.sendTextMessage(id, message);
            // Log to database
            messageRepo.create({
                jid: id,
                direction: 'outgoing',
                message,
                is_group: id.endsWith('@g.us') ? 1 : 0,
            });
            res.json({ success: true, jid: id, message });
        }
        catch (error) {
            next(error);
        }
    });
    return router;
}
