import { Router, Request, Response } from 'express';
import { getContactRepository } from '../../database/repositories/contact.repository.js';

export function createContactsRoutes(): Router {
  const router = Router();
  const contactRepo = getContactRepository();

  // Search contacts
  router.get('/search', (req: Request, res: Response) => {
    const query = req.query.q as string;
    if (!query) return res.status(400).json({ error: 'q parameter required' });
    const results = contactRepo.search(query);
    res.json(results);
  });

  // Get all contacts
  router.get('/', (req: Request, res: Response) => {
    const contacts = contactRepo.getAll();
    res.json(contacts);
  });

  // Get contact by ID
  router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
    const id = parseInt(req.params.id);
    const contact = contactRepo.getById(id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json(contact);
  });

  // Create contact
  router.post('/', (req: Request, res: Response) => {
    const { name, phone, notes, category } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: 'name and phone are required' });
    }
    const contact = contactRepo.create({ name, phone, notes, category });
    res.status(201).json(contact);
  });

  // Update contact
  router.put('/:id', (req: Request<{ id: string }>, res: Response) => {
    const id = parseInt(req.params.id);
    const { name, phone, notes, category } = req.body;
    const contact = contactRepo.update(id, { name, phone, notes, category });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json(contact);
  });

  // Delete contact
  router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
    const id = parseInt(req.params.id);
    const deleted = contactRepo.delete(id);
    if (deleted) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Contact not found' });
    }
  });

  return router;
}
