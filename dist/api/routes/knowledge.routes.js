import { Router } from 'express';
import { getKnowledgeRepository } from '../../database/repositories/knowledge.repository.js';
export function createKnowledgeRoutes() {
    const router = Router();
    const knowledgeRepo = getKnowledgeRepository();
    // Get all knowledge items for a chat
    router.get('/:jid', (req, res) => {
        const jid = decodeURIComponent(req.params.jid);
        const items = knowledgeRepo.getByJid(jid);
        res.json(items);
    });
    // Create new knowledge item
    router.post('/', (req, res) => {
        const { jid, title, content, category } = req.body;
        if (!jid || !title || !content) {
            return res.status(400).json({ error: 'jid, title, and content are required' });
        }
        const item = knowledgeRepo.create({ jid, title, content, category });
        res.status(201).json(item);
    });
    // Update knowledge item
    router.put('/:id', (req, res) => {
        const id = parseInt(req.params.id);
        const { title, content, category } = req.body;
        const item = knowledgeRepo.update(id, { title, content, category });
        if (!item) {
            return res.status(404).json({ error: 'Knowledge item not found' });
        }
        res.json(item);
    });
    // Delete knowledge item
    router.delete('/:id', (req, res) => {
        const id = parseInt(req.params.id);
        const deleted = knowledgeRepo.delete(id);
        if (deleted) {
            res.json({ success: true });
        }
        else {
            res.status(404).json({ error: 'Knowledge item not found' });
        }
    });
    return router;
}
