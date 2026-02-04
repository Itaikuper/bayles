import { Router, Request, Response } from 'express';
import { BotControlService } from '../../services/bot-control.service.js';
import { WhatsAppService } from '../../services/whatsapp.service.js';

export function createBotControlRoutes(
  botControl: BotControlService,
  whatsapp: WhatsAppService
): Router {
  const router = Router();

  // ============== Global Settings ==============

  // Get all settings
  router.get('/settings', (req: Request, res: Response) => {
    const settings = botControl.getSettings();
    res.json(settings);
  });

  // Update a setting
  router.put('/settings', (req: Request, res: Response) => {
    const { key, value } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'key and value are required' });
    }
    botControl.updateSetting(key, String(value));
    res.json({ success: true, key, value });
  });

  // Toggle bot on/off
  router.post('/toggle', (req: Request, res: Response) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required' });
    }
    botControl.setBotEnabled(enabled);
    res.json({ success: true, bot_enabled: enabled });
  });

  // Get bot status
  router.get('/status', (req: Request, res: Response) => {
    res.json({
      bot_enabled: botControl.isBotEnabled(),
      settings: botControl.getSettings(),
    });
  });

  // ============== Chat Configs (Whitelist) ==============

  // List all chat configs
  router.get('/chats', (req: Request, res: Response) => {
    const chats = botControl.getAllChats();
    res.json(chats);
  });

  // Get specific chat config
  router.get('/chats/:jid', (req: Request<{ jid: string }>, res: Response) => {
    const jid = decodeURIComponent(req.params.jid);
    const config = botControl.getChatConfig(jid);
    if (!config) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    res.json(config);
  });

  // Add chat to whitelist
  router.post('/chats', async (req: Request, res: Response) => {
    try {
      const { jid, display_name, is_group, enabled, ai_mode, custom_prompt, auto_reply_message } =
        req.body;

      if (!jid) {
        return res.status(400).json({ error: 'jid is required' });
      }

      const config = botControl.addChat({
        jid,
        display_name,
        is_group,
        enabled,
        ai_mode,
        custom_prompt,
        auto_reply_message,
      });

      res.status(201).json(config);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add chat';
      res.status(400).json({ error: message });
    }
  });

  // Update chat config
  router.put('/chats/:jid', (req: Request<{ jid: string }>, res: Response) => {
    const jid = decodeURIComponent(req.params.jid);
    const updates = req.body;

    const config = botControl.updateChat(jid, updates);
    if (!config) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    res.json(config);
  });

  // Remove chat from whitelist
  router.delete('/chats/:jid', (req: Request<{ jid: string }>, res: Response) => {
    const jid = decodeURIComponent(req.params.jid);
    const removed = botControl.removeChat(jid);
    if (!removed) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    res.json({ success: true });
  });

  // Quick toggle chat enabled/disabled
  router.post('/chats/:jid/toggle', (req: Request<{ jid: string }>, res: Response) => {
    const jid = decodeURIComponent(req.params.jid);
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required' });
    }

    const config = botControl.getChatConfig(jid);
    if (!config) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    botControl.toggleChat(jid, enabled);
    res.json({ success: true, jid, enabled });
  });

  // ============== Activity Log ==============

  // Get activity log
  router.get('/activity', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const activity = botControl.getActivityLog(limit, offset);
    res.json(activity);
  });

  // Get activity stats
  router.get('/activity/stats', (req: Request, res: Response) => {
    const stats = botControl.getActivityStats();
    res.json(stats);
  });

  // Get activity for specific chat
  router.get('/activity/:jid', (req: Request<{ jid: string }>, res: Response) => {
    const jid = decodeURIComponent(req.params.jid);
    const limit = parseInt(req.query.limit as string) || 50;
    const activity = botControl.getActivityByChat(jid, limit);
    res.json(activity);
  });

  // ============== Helper: Available Groups ==============

  // Get available groups to add to whitelist
  router.get('/available-groups', async (req: Request, res: Response) => {
    try {
      const groups = await whatsapp.getGroups();
      const existingChats = botControl.getAllChats();
      const existingJids = new Set(existingChats.map((c) => c.jid));

      // Mark which groups are already in whitelist
      const result = groups.map((group) => ({
        ...group,
        in_whitelist: existingJids.has(group.id),
      }));

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch groups' });
    }
  });

  return router;
}
