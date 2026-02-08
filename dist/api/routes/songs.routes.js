import { Router } from 'express';
import { getSongRepository } from '../../database/repositories/song.repository.js';
export function createSongsRoutes() {
    const router = Router();
    const songRepo = getSongRepository();
    // Search songs
    router.get('/search', (req, res) => {
        const query = req.query.q;
        if (!query)
            return res.status(400).json({ error: 'q parameter required' });
        const limit = parseInt(req.query.limit) || 20;
        const results = songRepo.search(query, limit);
        res.json(results);
    });
    // Get songs by artist
    router.get('/artist/:artist', (req, res) => {
        const artist = decodeURIComponent(req.params.artist);
        const results = songRepo.getByArtist(artist);
        res.json(results);
    });
    // Stats
    router.get('/stats', (req, res) => {
        res.json({ count: songRepo.count() });
    });
    // Get song by ID (must be last to avoid catching /search, /artist, /stats)
    router.get('/:id', (req, res) => {
        const id = decodeURIComponent(req.params.id);
        const song = songRepo.getById(id);
        if (!song)
            return res.status(404).json({ error: 'Song not found' });
        res.json(song);
    });
    return router;
}
