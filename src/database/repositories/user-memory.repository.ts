import { getDatabase } from '../db.js';

export interface UserMemory {
  id: number;
  jid: string;
  fact: string;
  category: string;
  tenant_id: string;
  created_at: string;
  updated_at: string;
}

const MAX_FACTS_PER_USER = 30;

export class UserMemoryRepository {
  private db = getDatabase();

  getByJid(jid: string, tenantId: string = 'default'): UserMemory[] {
    return this.db
      .prepare('SELECT * FROM user_memories WHERE jid = ? AND tenant_id = ? ORDER BY updated_at DESC')
      .all(jid, tenantId) as UserMemory[];
  }

  create(jid: string, fact: string, category: string = 'personal', tenantId: string = 'default'): UserMemory {
    this.db
      .prepare('INSERT INTO user_memories (jid, fact, category, tenant_id) VALUES (?, ?, ?, ?)')
      .run(jid, fact, category, tenantId);

    const id = this.db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };

    // Enforce max facts limit - delete oldest
    const count = this.db
      .prepare('SELECT COUNT(*) as cnt FROM user_memories WHERE jid = ? AND tenant_id = ?')
      .get(jid, tenantId) as { cnt: number };

    if (count.cnt > MAX_FACTS_PER_USER) {
      this.db
        .prepare(
          `DELETE FROM user_memories WHERE id IN (
            SELECT id FROM user_memories WHERE jid = ? AND tenant_id = ?
            ORDER BY updated_at ASC LIMIT ?
          )`
        )
        .run(jid, tenantId, count.cnt - MAX_FACTS_PER_USER);
    }

    return this.db.prepare('SELECT * FROM user_memories WHERE id = ?').get(id.id) as UserMemory;
  }

  update(id: number, fact: string): void {
    this.db
      .prepare("UPDATE user_memories SET fact = ?, updated_at = datetime('now') WHERE id = ?")
      .run(fact, id);
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM user_memories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  deleteByJid(jid: string, tenantId: string = 'default'): number {
    const result = this.db
      .prepare('DELETE FROM user_memories WHERE jid = ? AND tenant_id = ?')
      .run(jid, tenantId);
    return result.changes;
  }

  getFormattedMemories(jid: string, tenantId: string = 'default'): string {
    const items = this.getByJid(jid, tenantId);
    if (items.length === 0) return '';

    const formatted = items.map(item => `- ${item.fact}`).join('\n');
    return `\n\n## מה שאני יודע על המשתמש הזה:\n${formatted}`;
  }
}

let repositoryInstance: UserMemoryRepository | null = null;

export function getUserMemoryRepository(): UserMemoryRepository {
  if (!repositoryInstance) {
    repositoryInstance = new UserMemoryRepository();
  }
  return repositoryInstance;
}
