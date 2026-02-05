export interface ScheduleRecord {
    id: string;
    jid: string;
    message: string;
    cron_expression: string;
    one_time: number;
    scheduled_at?: string;
    created_at?: string;
    active?: number;
    use_ai: number;
}
export declare class ScheduleRepository {
    private db;
    create(record: {
        id: string;
        jid: string;
        message: string;
        cronExpression: string;
        oneTime: boolean;
        scheduledAt?: string;
        useAi?: boolean;
    }): void;
    findAllActive(): ScheduleRecord[];
    findById(id: string): ScheduleRecord | undefined;
    delete(id: string): boolean;
    markInactive(id: string): void;
    countActive(): number;
}
