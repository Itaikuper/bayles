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
export declare class TenantRepository {
    private db;
    getAll(): Tenant[];
    getById(id: string): Tenant | null;
    getConnected(): Tenant[];
    create(tenant: CreateTenant): Tenant;
    update(id: string, updates: UpdateTenant): Tenant | null;
    delete(id: string): boolean;
    setStatus(id: string, status: Tenant['status']): void;
    exists(id: string): boolean;
}
export declare function getTenantRepository(): TenantRepository;
