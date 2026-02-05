export type ResponseStatus = 'ignored' | 'responded' | 'auto_reply';
export interface ActivityLogEntry {
    id: number;
    jid: string;
    sender: string | null;
    message: string;
    is_group: number;
    response_status: ResponseStatus;
    reason: string | null;
    timestamp: string;
}
export interface CreateActivityLog {
    jid: string;
    sender?: string;
    message: string;
    is_group?: boolean;
    response_status: ResponseStatus;
    reason?: string;
}
export interface ActivityStats {
    total: number;
    responded: number;
    ignored: number;
    auto_reply: number;
    today_total: number;
    today_responded: number;
}
export declare class ActivityLogRepository {
    private db;
    log(entry: CreateActivityLog): void;
    getRecent(limit?: number, offset?: number): ActivityLogEntry[];
    getByJid(jid: string, limit?: number): ActivityLogEntry[];
    getByStatus(status: ResponseStatus, limit?: number): ActivityLogEntry[];
    getStats(): ActivityStats;
    clearOld(daysToKeep?: number): number;
}
export declare function getActivityLogRepository(): ActivityLogRepository;
