import { getDatabase } from '../database/db.js';
import { runMigrations } from '../database/migrate.js';
import { logger } from '../utils/logger.js';

const SONGS_URL = 'https://playalong-guitar.vercel.app/songs.json';

interface PlayAlongData {
  songs: Array<{
    id: string;
    title: string;
    artist: string;
    url?: string;
    capo?: number;
    sections?: unknown[];
  }>;
  total_songs: number;
  total_artists: number;
}

async function importSongs(): Promise<void> {
  runMigrations();

  logger.info(`Fetching songs from ${SONGS_URL}...`);
  const response = await fetch(SONGS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status}`);
  }

  const data = await response.json() as PlayAlongData;
  const songs = data.songs;
  logger.info(`Fetched ${songs.length} songs`);

  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO songs (id, title, artist, url, capo)
    VALUES (@id, @title, @artist, @url, @capo)
  `);

  const insertMany = db.transaction((items: typeof songs) => {
    for (const song of items) {
      stmt.run({
        id: song.id,
        title: song.title,
        artist: song.artist,
        url: `https://playalong-guitar.vercel.app/?song=${song.id}`,
        capo: song.capo ?? null,
      });
    }
  });

  insertMany(songs);
  logger.info(`Imported ${songs.length} songs successfully`);
}

importSongs().catch(err => {
  logger.error('Import failed:', err);
  process.exit(1);
});
