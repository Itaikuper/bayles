import { getDatabase } from '../db.js';

export interface ChoreRotationRecord {
  id: number;
  jid: string;
  name: string;
  members: string; // JSON array string
  current_index: number;
  frequency: string;
  reminder_hour: number;
  reminder_minute: number;
  active: number;
  last_sent_date: string | null;
  tenant_id: string;
  created_at: string;
  updated_at: string;
}

export class ChoreRotationRepository {
  private db = getDatabase();

  create(input: {
    jid: string;
    name: string;
    members: string[];
    frequency?: string;
    reminder_hour?: number;
    reminder_minute?: number;
  }): number {
    const stmt = this.db.prepare(`
      INSERT INTO chore_rotations (jid, name, members, frequency, reminder_hour, reminder_minute)
      VALUES (@jid, @name, @members, @frequency, @reminder_hour, @reminder_minute)
    `);
    const result = stmt.run({
      jid: input.jid,
      name: input.name,
      members: JSON.stringify(input.members),
      frequency: input.frequency || 'daily',
      reminder_hour: input.reminder_hour ?? 8,
      reminder_minute: input.reminder_minute ?? 0,
    });
    return result.lastInsertRowid as number;
  }

  findByJid(jid: string): ChoreRotationRecord[] {
    return this.db
      .prepare('SELECT * FROM chore_rotations WHERE jid = ? AND active = 1 ORDER BY name')
      .all(jid) as ChoreRotationRecord[];
  }

  findByJidAndName(jid: string, name: string): ChoreRotationRecord | undefined {
    return this.db
      .prepare('SELECT * FROM chore_rotations WHERE jid = ? AND name = ? AND active = 1')
      .get(jid, name) as ChoreRotationRecord | undefined;
  }

  /**
   * Fuzzy search: find rotation where name contains the query (case-insensitive)
   */
  searchByJidAndName(jid: string, query: string): ChoreRotationRecord | undefined {
    const rotations = this.findByJid(jid);
    // Try exact match first
    const exact = rotations.find(r => r.name === query);
    if (exact) return exact;
    // Try contains match
    return rotations.find(r => r.name.includes(query) || query.includes(r.name));
  }

  getActiveRotations(): ChoreRotationRecord[] {
    return this.db
      .prepare('SELECT * FROM chore_rotations WHERE active = 1')
      .all() as ChoreRotationRecord[];
  }

  advance(id: number, newIndex: number): void {
    this.db
      .prepare('UPDATE chore_rotations SET current_index = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(newIndex, id);
  }

  markSent(id: number, dateStr: string): void {
    this.db
      .prepare('UPDATE chore_rotations SET last_sent_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(dateStr, id);
  }

  updateMembers(id: number, members: string[]): void {
    this.db
      .prepare('UPDATE chore_rotations SET members = ?, current_index = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(members), id);
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM chore_rotations WHERE id = ?').run(id);
    return result.changes > 0;
  }

  deactivate(id: number): void {
    this.db
      .prepare('UPDATE chore_rotations SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(id);
  }

  count(): number {
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM chore_rotations WHERE active = 1')
      .get() as { count: number };
    return result.count;
  }
}

let instance: ChoreRotationRepository | null = null;
export function getChoreRotationRepository(): ChoreRotationRepository {
  if (!instance) instance = new ChoreRotationRepository();
  return instance;
}
