import { getDatabase } from '../db.js';

export interface KnowledgeItem {
  id: number;
  jid: string;
  title: string;
  content: string;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface CreateKnowledgeItem {
  jid: string;
  title: string;
  content: string;
  category?: string;
}

export interface UpdateKnowledgeItem {
  title?: string;
  content?: string;
  category?: string;
}

export class KnowledgeRepository {
  private db = getDatabase();

  getByJid(jid: string): KnowledgeItem[] {
    return this.db
      .prepare('SELECT * FROM knowledge_items WHERE jid = ? ORDER BY category, title')
      .all(jid) as KnowledgeItem[];
  }

  getById(id: number): KnowledgeItem | null {
    const row = this.db
      .prepare('SELECT * FROM knowledge_items WHERE id = ?')
      .get(id) as KnowledgeItem | undefined;
    return row ?? null;
  }

  create(input: CreateKnowledgeItem): KnowledgeItem {
    this.db
      .prepare(
        `INSERT INTO knowledge_items (jid, title, content, category)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        input.jid,
        input.title,
        input.content,
        input.category || 'general'
      );

    const id = this.db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };
    return this.getById(id.id)!;
  }

  update(id: number, updates: UpdateKnowledgeItem): KnowledgeItem | null {
    const fields: string[] = [];
    const values: (string | number)[] = [];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.content !== undefined) {
      fields.push('content = ?');
      values.push(updates.content);
    }
    if (updates.category !== undefined) {
      fields.push('category = ?');
      values.push(updates.category);
    }

    if (fields.length === 0) return this.getById(id);

    fields.push("updated_at = datetime('now')");
    values.push(id);

    this.db
      .prepare(`UPDATE knowledge_items SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getById(id);
  }

  delete(id: number): boolean {
    const result = this.db
      .prepare('DELETE FROM knowledge_items WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  deleteByJid(jid: string): number {
    const result = this.db
      .prepare('DELETE FROM knowledge_items WHERE jid = ?')
      .run(jid);
    return result.changes;
  }

  getFormattedKnowledge(jid: string): string {
    const items = this.getByJid(jid);
    if (items.length === 0) return '';

    const formatted = items.map(item => `### ${item.title}\n${item.content}`).join('\n\n');
    return `\n\n## מאגר ידע\n${formatted}`;
  }
}

let repositoryInstance: KnowledgeRepository | null = null;

export function getKnowledgeRepository(): KnowledgeRepository {
  if (!repositoryInstance) {
    repositoryInstance = new KnowledgeRepository();
  }
  return repositoryInstance;
}
