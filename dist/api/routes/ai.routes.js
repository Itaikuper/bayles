import { Router } from 'express';
import { getDatabase } from '../../database/db.js';
import { config } from '../../config/env.js';
export function createAiRoutes(gemini) {
    const router = Router();
    const db = getDatabase();
    // Get AI settings
    router.get('/settings', (req, res) => {
        // Try to get from database first
        const saved = db
            .prepare('SELECT value FROM ai_settings WHERE key = ?')
            .get('systemPrompt');
        res.json({
            systemPrompt: saved?.value || config.systemPrompt,
        });
    });
    // Update AI settings
    router.put('/settings', (req, res) => {
        const { systemPrompt } = req.body;
        if (!systemPrompt) {
            return res.status(400).json({ error: 'systemPrompt is required' });
        }
        // Save to database
        db.prepare(`
      INSERT OR REPLACE INTO ai_settings (key, value, updated_at)
      VALUES ('systemPrompt', ?, datetime('now'))
    `).run(systemPrompt);
        // Update in memory
        config.systemPrompt = systemPrompt;
        res.json({ success: true, systemPrompt });
    });
    // List all conversations
    router.get('/history', (req, res) => {
        const conversations = gemini.listConversations();
        res.json(conversations);
    });
    // Clear history for specific JID
    router.delete('/history/:jid', (req, res) => {
        const jid = decodeURIComponent(req.params.jid);
        gemini.clearHistory(jid);
        res.json({ success: true, jid });
    });
    // Clear all history
    router.delete('/history', (req, res) => {
        gemini.clearAllHistory();
        res.json({ success: true });
    });
    return router;
}
