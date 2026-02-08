import { Router, Request, Response } from 'express';
import { getSongRepository } from '../../database/repositories/song.repository.js';

export function createSongsRoutes(): Router {
  const router = Router();
  const songRepo = getSongRepository();

  // Search songs
  router.get('/search', (req: Request, res: Response) => {
    const query = req.query.q as string;
    if (!query) return res.status(400).json({ error: 'q parameter required' });
    const limit = parseInt(req.query.limit as string) || 20;
    const results = songRepo.search(query, limit);
    res.json(results);
  });

  // Get songs by artist
  router.get('/artist/:artist', (req: Request<{ artist: string }>, res: Response) => {
    const artist = decodeURIComponent(req.params.artist);
    const results = songRepo.getByArtist(artist);
    res.json(results);
  });

  // Stats
  router.get('/stats', (req: Request, res: Response) => {
    res.json({ count: songRepo.count() });
  });

  // Get song by ID (must be last to avoid catching /search, /artist, /stats)
  router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
    const id = decodeURIComponent(req.params.id);
    const song = songRepo.getById(id);
    if (!song) return res.status(404).json({ error: 'Song not found' });
    res.json(song);
  });

  return router;
}
