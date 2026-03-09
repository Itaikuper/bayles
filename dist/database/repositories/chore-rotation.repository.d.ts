export interface ChoreRotationRecord {
    id: number;
    jid: string;
    name: string;
    members: string;
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
export declare class ChoreRotationRepository {
    private db;
    create(input: {
        jid: string;
        name: string;
        members: string[];
        frequency?: string;
        reminder_hour?: number;
        reminder_minute?: number;
    }): number;
    findByJid(jid: string): ChoreRotationRecord[];
    findByJidAndName(jid: string, name: string): ChoreRotationRecord | undefined;
    /**
     * Fuzzy search: find rotation where name contains the query (case-insensitive)
     */
    searchByJidAndName(jid: string, query: string): ChoreRotationRecord | undefined;
    getActiveRotations(): ChoreRotationRecord[];
    advance(id: number, newIndex: number): void;
    markSent(id: number, dateStr: string): void;
    updateMembers(id: number, members: string[]): void;
    delete(id: number): boolean;
    deactivate(id: number): void;
    count(): number;
}
export declare function getChoreRotationRepository(): ChoreRotationRepository;
