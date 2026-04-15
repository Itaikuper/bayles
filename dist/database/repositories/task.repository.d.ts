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
    /**
     * Hard-delete a task by id. Row is physically removed from the tasks table.
     * After delete, compacts sqlite_sequence.tasks down to MAX(id) of remaining rows
     * so the next add picks up just above the highest surviving id (no ugly ID
     * climbing from gaps). Distinct from complete() which keeps the row with
     * status='done'.
     */
    remove(id: number): boolean;
    /**
     * Bulk hard-delete. Filter semantics identical to list(). Returns count deleted.
     * Refuses empty filter as a safety valve so we never accidentally nuke everything.
     *   - status='active' → pending OR (snoozed AND past due_until)
     *   - status=<other> → exact status match
     *   - category → case-insensitive category filter (combinable with status)
     *
     * After delete, compacts `sqlite_sequence.tasks` down to MAX(id) of remaining rows.
     * This prevents ugly ID jumps ("I cleared the list, why is my new task #47?"). IDs
     * still never duplicate live rows, but after a mass cleanup the next add picks up
     * just above the highest surviving id instead of the highest-ever-used id.
     */
    removeBulk(jid: string, filter?: {
        status?: 'pending' | 'done' | 'snoozed' | 'active';
        category?: string;
    }): number;
    snooze(id: number, untilMs: number): boolean;
}
