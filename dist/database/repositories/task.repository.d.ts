export interface TaskRecord {
    id: number;
    jid: string;
    title: string;
    notes: string | null;
    category: string | null;
    status: 'pending' | 'done' | 'snoozed';
    due_at: number | null;
    snooze_until: number | null;
    created_at: number;
    updated_at: number;
    completed_at: number | null;
}
export interface TaskEditPatch {
    title?: string;
    notes?: string | null;
    category?: string | null;
    dueAt?: number | null;
}
export declare function getTaskRepository(): TaskRepository;
export declare class TaskRepository {
    add(jid: string, title: string, opts?: {
        notes?: string;
        dueAt?: number;
        category?: string;
    }): TaskRecord;
    getById(id: number): TaskRecord | undefined;
    /**
     * List tasks for a JID, optionally filtered by status and/or category.
     * Ordering: due date ascending (earliest first), NULL due dates last, then created_at ascending.
     */
    list(jid: string, status?: 'pending' | 'done' | 'snoozed' | 'active', category?: string): TaskRecord[];
    /** Distinct categories with active-task counts — useful for "what categories do I have?". */
    listCategories(jid: string): {
        category: string;
        count: number;
    }[];
    /** Find by partial title (case-insensitive). Used by complete/snooze/edit when the model doesn't have an id. */
    findByTitle(jid: string, query: string): TaskRecord[];
    /** Update selected fields. Only provided keys are changed. Returns the updated row. */
    edit(id: number, patch: TaskEditPatch): TaskRecord | undefined;
    complete(id: number): boolean;
    snooze(id: number, untilMs: number): boolean;
}
