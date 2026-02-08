import { getDatabase } from '../db.js';
// Hebrew stop words to filter out from search queries
const STOP_WORDS = new Set([
    'של', 'את', 'על', 'עם', 'אל', 'מה', 'גם', 'כי', 'כל', 'אם', 'או',
    'לא', 'הוא', 'היא', 'זה', 'זו', 'הם', 'הן', 'אני', 'לי', 'לו', 'לה',
    'לשיר', 'שיר', 'אקורד', 'אקורדים', 'טאבים', 'גיטרה',
    'the', 'of', 'and', 'a', 'an', 'in', 'to', 'for', 'by',
]);
export class SongRepository {
    db = getDatabase();
    search(query, limit = 10) {
        const words = query.trim().split(/\s+/).filter(w => w.length > 0 && !STOP_WORDS.has(w));
        if (words.length === 0)
            return [];
        // Each word must appear somewhere in title or artist
        const conditions = words.map(() => `(title || ' ' || artist) LIKE ?`);
        const params = words.map(w => `%${w}%`);
        return this.db
            .prepare(`
        SELECT id, title, artist, url, capo, tenant_id
        FROM songs
        WHERE ${conditions.join(' AND ')}
        ORDER BY
          CASE
            WHEN title LIKE ? THEN 1
            WHEN artist LIKE ? THEN 2
            ELSE 3
          END,
          title
        LIMIT ?
      `)
            .all(...params, `${query}%`, `${query}%`, limit);
    }
    getById(id) {
        const row = this.db
            .prepare('SELECT * FROM songs WHERE id = ?')
            .get(id);
        return row ?? null;
    }
    getByArtist(artist, limit = 50) {
        return this.db
            .prepare(`
        SELECT id, title, artist, url, capo, tenant_id
        FROM songs
        WHERE artist LIKE ?
        ORDER BY title
        LIMIT ?
      `)
            .all(`%${artist}%`, limit);
    }
    upsert(song) {
        this.db
            .prepare(`
        INSERT OR REPLACE INTO songs (id, title, artist, url, capo)
        VALUES (@id, @title, @artist, @url, @capo)
      `)
            .run(song);
    }
    count() {
        const result = this.db
            .prepare('SELECT COUNT(*) as count FROM songs')
            .get();
        return result.count;
    }
}
let songRepoInstance = null;
export function getSongRepository() {
    if (!songRepoInstance) {
        songRepoInstance = new SongRepository();
    }
    return songRepoInstance;
}
