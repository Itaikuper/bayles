import { Router } from 'express';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/env.js';
export function createGmailRoutes(gmail) {
    const router = Router();
    router.get('/oauth/start', (req, res) => {
        const jid = req.query.jid || config.gmailOwnerJid;
        if (!gmail.isOwner(jid)) {
            res.status(403).json({ error: 'Only the configured owner JID can link Gmail' });
            return;
        }
        try {
            const url = gmail.getAuthUrl(jid);
            res.json({ url });
        }
        catch (err) {
            res.status(500).json({ error: err instanceof Error ? err.message : 'unknown error' });
        }
    });
    router.get('/oauth/callback', async (req, res) => {
        const code = req.query.code;
        const state = req.query.state;
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
        }
        catch (err) {
            logger.error('Gmail OAuth callback failed:', err);
            res.status(500).send(`<pre>${err instanceof Error ? err.message : 'unknown error'}</pre>`);
        }
    });
    router.get('/labels', async (req, res) => {
        const jid = req.query.jid || config.gmailOwnerJid;
        if (!gmail.isOwner(jid)) {
            res.status(403).json({ error: 'forbidden' });
            return;
        }
        try {
            const labels = await gmail.listAllGmailLabels(jid);
            res.json({ labels });
        }
        catch (err) {
            res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
        }
    });
    return router;
}
