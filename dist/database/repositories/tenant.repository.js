import { getDatabase } from '../db.js';
export class TenantRepository {
    db = getDatabase();
    getAll() {
        return this.db
            .prepare('SELECT * FROM tenants ORDER BY created_at DESC')
            .all();
    }
    getById(id) {
        const row = this.db
            .prepare('SELECT * FROM tenants WHERE id = ?')
            .get(id);
        return row ?? null;
    }
    getConnected() {
        return this.db
            .prepare("SELECT * FROM tenants WHERE status = 'connected' ORDER BY name")
            .all();
    }
    create(tenant) {
        this.db
            .prepare(`INSERT INTO tenants (id, name, phone, system_prompt)
         VALUES (?, ?, ?, ?)`)
            .run(tenant.id, tenant.name, tenant.phone ?? null, tenant.system_prompt ?? null);
        return this.getById(tenant.id);
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
        if (updates.status !== undefined) {
            fields.push('status = ?');
            values.push(updates.status);
        }
        if (updates.system_prompt !== undefined) {
            fields.push('system_prompt = ?');
            values.push(updates.system_prompt);
        }
        if (fields.length === 0)
            return this.getById(id);
        fields.push("updated_at = datetime('now')");
        values.push(id);
        this.db
            .prepare(`UPDATE tenants SET ${fields.join(', ')} WHERE id = ?`)
            .run(...values);
        return this.getById(id);
    }
    delete(id) {
        if (id === 'default') {
            throw new Error('Cannot delete default tenant');
        }
        const result = this.db
            .prepare('DELETE FROM tenants WHERE id = ?')
            .run(id);
        return result.changes > 0;
    }
    setStatus(id, status) {
        this.db
            .prepare("UPDATE tenants SET status = ?, updated_at = datetime('now') WHERE id = ?")
            .run(status, id);
    }
    exists(id) {
        const row = this.db
            .prepare('SELECT 1 FROM tenants WHERE id = ?')
            .get(id);
        return !!row;
    }
}
let repositoryInstance = null;
export function getTenantRepository() {
    if (!repositoryInstance) {
        repositoryInstance = new TenantRepository();
    }
    return repositoryInstance;
}
