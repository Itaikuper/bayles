import { Router, Request, Response } from 'express';
import QRCode from 'qrcode';
import { getTenantRepository } from '../../database/repositories/tenant.repository.js';
import { getWhatsAppPool } from '../../services/whatsapp-pool.service.js';
import { getKnowledgeRepository } from '../../database/repositories/knowledge.repository.js';

export function createTenantsRoutes(): Router {
  const router = Router();
  const tenantRepo = getTenantRepository();
  const pool = getWhatsAppPool();
  const knowledgeRepo = getKnowledgeRepository();

  // Get all tenants
  router.get('/', (_req: Request, res: Response) => {
    const tenants = tenantRepo.getAll();
    const tenantsWithStatus = tenants.map(tenant => ({
      ...tenant,
      connectionStatus: pool.getStatus(tenant.id),
    }));
    res.json(tenantsWithStatus);
  });

  // Get single tenant
  router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
    const tenant = tenantRepo.getById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    res.json({
      ...tenant,
      connectionStatus: pool.getStatus(tenant.id),
    });
  });

  // Create new tenant
  router.post('/', (req: Request, res: Response) => {
    const { id, name, system_prompt } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    // Generate ID if not provided
    const tenantId = id || `tenant_${Date.now()}`;

    if (tenantRepo.exists(tenantId)) {
      return res.status(409).json({ error: 'Tenant already exists' });
    }

    const tenant = tenantRepo.create({
      id: tenantId,
      name,
      system_prompt,
    });

    res.status(201).json(tenant);
  });

  // Update tenant
  router.put('/:id', (req: Request<{ id: string }>, res: Response) => {
    const { name, system_prompt } = req.body;

    const tenant = tenantRepo.update(req.params.id, { name, system_prompt });
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json(tenant);
  });

  // Delete tenant
  router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
      // Disconnect first if connected
      pool.disconnect(req.params.id);

      const deleted = tenantRepo.delete(req.params.id);
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Tenant not found' });
      }
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Connect tenant (start WhatsApp connection, returns QR if needed)
  router.post('/:id/connect', async (req: Request<{ id: string }>, res: Response) => {
    const tenant = tenantRepo.getById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    try {
      await pool.connect(req.params.id);

      // Wait a bit for QR code to generate
      await new Promise(resolve => setTimeout(resolve, 2000));

      const qr = pool.getQRCode(req.params.id);
      const status = pool.getStatus(req.params.id);

      res.json({
        status,
        hasQR: !!qr,
        message: status === 'connected'
          ? 'Already connected'
          : qr
            ? 'QR code ready for scanning'
            : 'Connecting...',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get QR code for tenant (as image)
  router.get('/:id/qr', async (req: Request<{ id: string }>, res: Response) => {
    const tenant = tenantRepo.getById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const qr = pool.getQRCode(req.params.id);
    if (!qr) {
      const status = pool.getStatus(req.params.id);
      if (status === 'connected') {
        return res.status(200).json({ message: 'Already connected', status });
      }
      return res.status(404).json({ error: 'No QR code available. Try connecting first.', status });
    }

    // Return as PNG image
    const format = req.query.format;
    if (format === 'json') {
      res.json({ qr });
    } else {
      res.type('png');
      const qrImage = await QRCode.toBuffer(qr, { type: 'png', width: 300 });
      res.send(qrImage);
    }
  });

  // Get connection status
  router.get('/:id/status', (req: Request<{ id: string }>, res: Response) => {
    const tenant = tenantRepo.getById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const status = pool.getStatus(req.params.id);
    const botJid = pool.getBotJid(req.params.id);

    res.json({
      status,
      connected: status === 'connected',
      phone: tenant.phone,
      botJid,
      hasQR: !!pool.getQRCode(req.params.id),
    });
  });

  // Disconnect tenant
  router.post('/:id/disconnect', async (req: Request<{ id: string }>, res: Response) => {
    const tenant = tenantRepo.getById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    await pool.disconnect(req.params.id);
    res.json({ success: true, status: 'disconnected' });
  });

  // === Knowledge Base per Tenant ===

  // Get all knowledge items for tenant
  router.get('/:id/knowledge', (req: Request<{ id: string }>, res: Response) => {
    const tenant = tenantRepo.getById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Get global knowledge items for this tenant (jid = tenant.id)
    const items = knowledgeRepo.getByJid(req.params.id);
    res.json(items);
  });

  // Add knowledge item for tenant
  router.post('/:id/knowledge', (req: Request<{ id: string }>, res: Response) => {
    const tenant = tenantRepo.getById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const { title, content, category } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    const item = knowledgeRepo.create({
      jid: req.params.id, // Use tenant ID as JID for global tenant knowledge
      title,
      content,
      category,
    });
    res.status(201).json(item);
  });

  // Update knowledge item
  router.put('/:id/knowledge/:kbId', (req: Request<{ id: string; kbId: string }>, res: Response) => {
    const tenant = tenantRepo.getById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const kbId = parseInt(req.params.kbId);
    const { title, content, category } = req.body;

    const item = knowledgeRepo.update(kbId, { title, content, category });
    if (!item) {
      return res.status(404).json({ error: 'Knowledge item not found' });
    }

    res.json(item);
  });

  // Delete knowledge item
  router.delete('/:id/knowledge/:kbId', (req: Request<{ id: string; kbId: string }>, res: Response) => {
    const tenant = tenantRepo.getById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const kbId = parseInt(req.params.kbId);
    const deleted = knowledgeRepo.delete(kbId);

    if (deleted) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Knowledge item not found' });
    }
  });

  return router;
}
