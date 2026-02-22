import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRoutes } from './routes/index.js';
import { logger } from '../utils/logger.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export function createApiServer(whatsapp, gemini, scheduler, botControl, birthdayService, calendarService) {
    const app = express();
    // Middleware
    app.use(express.json());
    // CORS for local development
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
            return res.sendStatus(200);
        }
        next();
    });
    // Serve static files (React dashboard)
    app.use(express.static(path.join(__dirname, '../../web')));
    // API routes - inject services
    app.use('/api', createRoutes(whatsapp, gemini, scheduler, botControl, birthdayService, calendarService));
    // SPA fallback - serve index.html for non-API routes
    app.use((req, res, next) => {
        if (req.method === 'GET' && !req.path.startsWith('/api')) {
            res.sendFile(path.join(__dirname, '../../web/index.html'));
        }
        else if (req.path.startsWith('/api')) {
            res.status(404).json({ error: 'Not found' });
        }
        else {
            next();
        }
    });
    // Error handling middleware
    app.use((err, req, res, _next) => {
        logger.error('API Error:', err.message);
        res.status(500).json({ error: err.message || 'Internal server error' });
    });
    return app;
}
export function startApiServer(app, port = 3000) {
    app.listen(port, () => {
        logger.info(`Dashboard running at http://localhost:${port}`);
    });
}
