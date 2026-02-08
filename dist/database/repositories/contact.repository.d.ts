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
export declare class ContactRepository {
    private db;
    search(query: string, tenantId?: string, limit?: number): ContactRecord[];
    getAll(tenantId?: string): ContactRecord[];
    getById(id: number): ContactRecord | null;
    create(input: {
        name: string;
        phone: string;
        notes?: string;
        category?: string;
        tenant_id?: string;
    }): ContactRecord;
    update(id: number, updates: {
        name?: string;
        phone?: string;
        notes?: string;
        category?: string;
    }): ContactRecord | null;
    delete(id: number): boolean;
    count(tenantId?: string): number;
}
export declare function getContactRepository(): ContactRepository;
