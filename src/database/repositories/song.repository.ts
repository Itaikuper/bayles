import { getDatabase } from '../db.js';

export interface SongRecord {
  id: string;
  title: string;
  artist: string;
  url: string;
  capo: number | null;
  tenant_id: string;
}

export class SongRepository {
  private db = getDatabase();

  search(query: string, limit: number = 10): SongRecord[] {
    const words = query.trim().split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return [];

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
      .all(...params, `${query}%`, `${query}%`, limit) as SongRecord[];
  }

  getById(id: string): SongRecord | null {
    const row = this.db
      .prepare('SELECT * FROM songs WHERE id = ?')
      .get(id) as SongRecord | undefined;
    return row ?? null;
  }

  getByArtist(artist: string, limit: number = 50): SongRecord[] {
    return this.db
      .prepare(`
        SELECT id, title, artist, url, capo, tenant_id
        FROM songs
        WHERE artist LIKE ?
        ORDER BY title
        LIMIT ?
      `)
      .all(`%${artist}%`, limit) as SongRecord[];
  }

  upsert(song: { id: string; title: string; artist: string; url: string; capo: number | null }): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO songs (id, title, artist, url, capo)
        VALUES (@id, @title, @artist, @url, @capo)
      `)
      .run(song);
  }

  count(): number {
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM songs')
      .get() as { count: number };
    return result.count;
  }
}

let songRepoInstance: SongRepository | null = null;

export function getSongRepository(): SongRepository {
  if (!songRepoInstance) {
    songRepoInstance = new SongRepository();
  }
  return songRepoInstance;
}
