import { getDatabase } from '../db.js';

export interface HoshayaDirectoryRecord {
  id: number;
  first_name: string;
  last_name: string;
  home_phone: string;
  mobile_phone: string;
  address: string;
  created_at: string;
}

export class HoshayaDirectoryRepository {
  private db = getDatabase();

  search(query: string, limit: number = 10): HoshayaDirectoryRecord[] {
    const words = query.trim().split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return [];

    if (words.length === 1) {
      // Single word: match against first_name OR last_name
      return this.db
        .prepare(`
          SELECT * FROM hoshaya_directory
          WHERE first_name LIKE ? OR last_name LIKE ?
          ORDER BY
            CASE
              WHEN first_name = ? OR last_name = ? THEN 1
              WHEN first_name LIKE ? OR last_name LIKE ? THEN 2
              ELSE 3
            END,
            last_name, first_name
          LIMIT ?
        `)
        .all(
          `%${words[0]}%`, `%${words[0]}%`,
          words[0], words[0],
          `${words[0]}%`, `${words[0]}%`,
          limit
        ) as HoshayaDirectoryRecord[];
    }

    // Multiple words: try first_name + last_name combination
    const conditions = words.map(() => `(first_name || ' ' || last_name) LIKE ?`);
    const params = words.map(w => `%${w}%`);

    return this.db
      .prepare(`
        SELECT * FROM hoshaya_directory
        WHERE ${conditions.join(' AND ')}
        ORDER BY
          CASE
            WHEN first_name || ' ' || last_name = ? THEN 1
            ELSE 2
          END,
          last_name, first_name
        LIMIT ?
      `)
      .all(...params, query, limit) as HoshayaDirectoryRecord[];
  }

  getAll(): HoshayaDirectoryRecord[] {
    return this.db
      .prepare('SELECT * FROM hoshaya_directory ORDER BY last_name, first_name')
      .all() as HoshayaDirectoryRecord[];
  }

  count(): number {
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM hoshaya_directory')
      .get() as { count: number };
    return result.count;
  }

  bulkInsert(entries: { first_name: string; last_name: string; home_phone: string; mobile_phone: string; address: string }[]): number {
    const insert = this.db.prepare(`
      INSERT INTO hoshaya_directory (first_name, last_name, home_phone, mobile_phone, address)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: typeof entries) => {
      let count = 0;
      for (const item of items) {
        insert.run(item.first_name, item.last_name, item.home_phone, item.mobile_phone, item.address);
        count++;
      }
      return count;
    });

    return insertMany(entries);
  }

  clear(): void {
    this.db.prepare('DELETE FROM hoshaya_directory').run();
  }
}

let instance: HoshayaDirectoryRepository | null = null;

export function getHoshayaDirectoryRepository(): HoshayaDirectoryRepository {
  if (!instance) {
    instance = new HoshayaDirectoryRepository();
  }
  return instance;
}
