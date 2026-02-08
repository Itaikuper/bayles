import { getDatabase } from '../db.js';
export class ContactRepository {
    db = getDatabase();
    search(query, tenantId = 'default', limit = 10) {
        return this.db
            .prepare(`
        SELECT * FROM contacts
        WHERE tenant_id = ? AND name LIKE ?
        ORDER BY name
        LIMIT ?
      `)
            .all(tenantId, `%${query}%`, limit);
    }
    getAll(tenantId = 'default') {
        return this.db
            .prepare('SELECT * FROM contacts WHERE tenant_id = ? ORDER BY name')
            .all(tenantId);
    }
    getById(id) {
        const row = this.db
            .prepare('SELECT * FROM contacts WHERE id = ?')
            .get(id);
        return row ?? null;
    }
    create(input) {
        this.db
            .prepare(`
        INSERT INTO contacts (name, phone, notes, category, tenant_id)
        VALUES (?, ?, ?, ?, ?)
      `)
            .run(input.name, input.phone, input.notes || null, input.category || 'general', input.tenant_id || 'default');
        const { id } = this.db.prepare('SELECT last_insert_rowid() as id').get();
        return this.getById(id);
    }
    update(id, updates) {
        const fields = [];
        const values = [];
        if (updates.name !== undefined) {
            fields.push('name = ?');
            values.push(updates.name);
        }
        if (updates.phone !== undefined) {
            fields.push('phone = ?');
            values.push(updates.phone);
        }
        if (updates.notes !== undefined) {
            fields.push('notes = ?');
            values.push(updates.notes);
        }
        if (updates.category !== undefined) {
            fields.push('category = ?');
            values.push(updates.category);
        }
        if (fields.length === 0)
            return this.getById(id);
        fields.push("updated_at = datetime('now')");
        values.push(id);
        this.db
            .prepare(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ?`)
            .run(...values);
        return this.getById(id);
    }
    delete(id) {
        const result = this.db
            .prepare('DELETE FROM contacts WHERE id = ?')
            .run(id);
        return result.changes > 0;
    }
    count(tenantId = 'default') {
        const result = this.db
            .prepare('SELECT COUNT(*) as count FROM contacts WHERE tenant_id = ?')
            .get(tenantId);
        return result.count;
    }
}
let contactRepoInstance = null;
export function getContactRepository() {
    if (!contactRepoInstance) {
        contactRepoInstance = new ContactRepository();
    }
    return contactRepoInstance;
}
