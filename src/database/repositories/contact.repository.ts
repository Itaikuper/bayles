import { getDatabase } from '../db.js';

export interface ContactRecord {
  id: number;
  name: string;
  phone: string;
  notes: string | null;
  category: string;
  tenant_id: string;
  created_at: string;
  updated_at: string;
}

export class ContactRepository {
  private db = getDatabase();

  search(query: string, tenantId: string = 'default', limit: number = 10): ContactRecord[] {
    return this.db
      .prepare(`
        SELECT * FROM contacts
        WHERE tenant_id = ? AND name LIKE ?
        ORDER BY name
        LIMIT ?
      `)
      .all(tenantId, `%${query}%`, limit) as ContactRecord[];
  }

  getAll(tenantId: string = 'default'): ContactRecord[] {
    return this.db
      .prepare('SELECT * FROM contacts WHERE tenant_id = ? ORDER BY name')
      .all(tenantId) as ContactRecord[];
  }

  getById(id: number): ContactRecord | null {
    const row = this.db
      .prepare('SELECT * FROM contacts WHERE id = ?')
      .get(id) as ContactRecord | undefined;
    return row ?? null;
  }

  create(input: { name: string; phone: string; notes?: string; category?: string; tenant_id?: string }): ContactRecord {
    this.db
      .prepare(`
        INSERT INTO contacts (name, phone, notes, category, tenant_id)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(input.name, input.phone, input.notes || null, input.category || 'general', input.tenant_id || 'default');

    const { id } = this.db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };
    return this.getById(id)!;
  }

  update(id: number, updates: { name?: string; phone?: string; notes?: string; category?: string }): ContactRecord | null {
    const fields: string[] = [];
    const values: (string | number)[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.phone !== undefined) { fields.push('phone = ?'); values.push(updates.phone); }
    if (updates.notes !== undefined) { fields.push('notes = ?'); values.push(updates.notes); }
    if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }

    if (fields.length === 0) return this.getById(id);

    fields.push("updated_at = datetime('now')");
    values.push(id);

    this.db
      .prepare(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getById(id);
  }

  delete(id: number): boolean {
    const result = this.db
      .prepare('DELETE FROM contacts WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  count(tenantId: string = 'default'): number {
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM contacts WHERE tenant_id = ?')
      .get(tenantId) as { count: number };
    return result.count;
  }
}

let contactRepoInstance: ContactRepository | null = null;

export function getContactRepository(): ContactRepository {
  if (!contactRepoInstance) {
    contactRepoInstance = new ContactRepository();
  }
  return contactRepoInstance;
}
