import { Router, Request, Response } from 'express';
import { GmailService } from '../../services/gmail.service.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/env.js';

export function createGmailRoutes(gmail: GmailService): Router {
  const router = Router();

  router.get('/oauth/start', (req: Request, res: Response) => {
    const jid = (req.query.jid as string | undefined) || config.gmailOwnerJid;
    if (!gmail.isOwner(jid)) {
      res.status(403).json({ error: 'Only the configured owner JID can link Gmail' });
      return;
    }
    try {
      const url = gmail.getAuthUrl(jid);
      res.json({ url });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'unknown error' });
    }
  });

  router.get('/oauth/callback', async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    if (!code || !state) {
      res.status(400).send('Missing code or state');
      return;
    }
    if (!gmail.isOwner(state)) {
      res.status(403).send('State does not match configured owner JID');
      return;
    }
    try {
      const { email } = await gmail.handleOAuthCallback(code, state);
      res.send(`<html><body style="font-family:system-ui;padding:2rem;"><h2>Gmail linked ✓</h2><p>Account: ${email}</p><p>You can close this window.</p></body></html>`);
    } catch (err) {
      logger.error('Gmail OAuth callback failed:', err);
      res.status(500).send(`<pre>${err instanceof Error ? err.message : 'unknown error'}</pre>`);
    }
  });

  router.get('/labels', async (req: Request, res: Response) => {
    const jid = (req.query.jid as string | undefined) || config.gmailOwnerJid;
    if (!gmail.isOwner(jid)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    try {
      const labels = await gmail.listAllGmailLabels(jid);
      res.json({ labels });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
    }
  });

  return router;
}
