export interface TaskRecord {
    id: number;
    jid: string;
    title: string;
    notes: string | null;
    status: 'pending' | 'done' | 'snoozed';
    due_at: number | null;
    snooze_until: number | null;
    created_at: number;
    updated_at: number;
    completed_at: number | null;
}
export declare function getTaskRepository(): TaskRepository;
export declare class TaskRepository {
    add(jid: string, title: string, opts?: {
        notes?: string;
        dueAt?: number;
    }): TaskRecord;
    getById(id: number): TaskRecord | undefined;
    list(jid: string, status?: 'pending' | 'done' | 'snoozed' | 'active'): TaskRecord[];
    /** Find by partial title (case-insensitive). Used by complete/snooze when the model doesn't have an id. */
    findByTitle(jid: string, query: string): TaskRecord[];
    complete(id: number): boolean;
    snooze(id: number, untilMs: number): boolean;
}
