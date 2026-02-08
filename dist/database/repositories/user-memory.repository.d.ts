export interface UserMemory {
    id: number;
    jid: string;
    fact: string;
    category: string;
    tenant_id: string;
    created_at: string;
    updated_at: string;
}
export declare class UserMemoryRepository {
    private db;
    getByJid(jid: string, tenantId?: string): UserMemory[];
    create(jid: string, fact: string, category?: string, tenantId?: string): UserMemory;
    update(id: number, fact: string): void;
    delete(id: number): boolean;
    deleteByJid(jid: string, tenantId?: string): number;
    getFormattedMemories(jid: string, tenantId?: string): string;
}
export declare function getUserMemoryRepository(): UserMemoryRepository;
