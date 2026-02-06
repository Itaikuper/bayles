import { getDatabase } from '../db.js';

export interface Tenant {
  id: string;
  name: string;
  phone: string | null;
  status: 'pending' | 'connecting' | 'connected' | 'disconnected';
  system_prompt: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTenant {
  id: string;
  name: string;
  phone?: string;
  system_prompt?: string;
}

export interface UpdateTenant {
  name?: string;
  phone?: string;
  status?: Tenant['status'];
  system_prompt?: string;
}

export class TenantRepository {
  private db = getDatabase();

  getAll(): Tenant[] {
    return this.db
      .prepare('SELECT * FROM tenants ORDER BY created_at DESC')
      .all() as Tenant[];
  }

  getById(id: string): Tenant | null {
    const row = this.db
      .prepare('SELECT * FROM tenants WHERE id = ?')
      .get(id) as Tenant | undefined;
    return row ?? null;
  }

  getConnected(): Tenant[] {
    return this.db
      .prepare("SELECT * FROM tenants WHERE status = 'connected' ORDER BY name")
      .all() as Tenant[];
  }

  create(tenant: CreateTenant): Tenant {
    this.db
      .prepare(
        `INSERT INTO tenants (id, name, phone, system_prompt)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        tenant.id,
        tenant.name,
        tenant.phone ?? null,
        tenant.system_prompt ?? null
      );

    return this.getById(tenant.id)!;
  }

  update(id: string, updates: UpdateTenant): Tenant | null {
    const fields: string[] = [];
    const values: (string | null)[] = [];

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

    if (fields.length === 0) return this.getById(id);

    fields.push("updated_at = datetime('now')");
    values.push(id);

    this.db
      .prepare(`UPDATE tenants SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getById(id);
  }

  delete(id: string): boolean {
    if (id === 'default') {
      throw new Error('Cannot delete default tenant');
    }
    const result = this.db
      .prepare('DELETE FROM tenants WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  setStatus(id: string, status: Tenant['status']): void {
    this.db
      .prepare("UPDATE tenants SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, id);
  }

  exists(id: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM tenants WHERE id = ?')
      .get(id);
    return !!row;
  }
}

let repositoryInstance: TenantRepository | null = null;

export function getTenantRepository(): TenantRepository {
  if (!repositoryInstance) {
    repositoryInstance = new TenantRepository();
  }
  return repositoryInstance;
}
