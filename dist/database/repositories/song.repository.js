import { getDatabase } from '../db.js';
export class SongRepository {
    db = getDatabase();
    search(query, limit = 10) {
        return this.db
            .prepare(`
        SELECT id, title, artist, url, capo, tenant_id
        FROM songs
        WHERE title LIKE ? OR artist LIKE ?
        ORDER BY
          CASE
            WHEN title LIKE ? THEN 1
            WHEN artist LIKE ? THEN 2
            ELSE 3
          END,
          title
        LIMIT ?
      `)
            .all(`%${query}%`, `%${query}%`, `${query}%`, `${query}%`, limit);
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
