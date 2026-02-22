export interface CalendarLinkRecord {
    id: number;
    jid: string;
    calendar_id: string;
    display_name: string | null;
    is_default: number;
    daily_summary: number;
    reminder_minutes: number | null;
    tenant_id: string;
    created_at: string;
}
export declare function getCalendarLinkRepository(): CalendarLinkRepository;
export declare class CalendarLinkRepository {
    findByJid(jid: string, tenantId?: string): CalendarLinkRecord[];
    findDefaultByJid(jid: string, tenantId?: string): CalendarLinkRecord | undefined;
    findDailySummaryLinks(tenantId?: string): CalendarLinkRecord[];
    findReminderLinks(tenantId?: string): CalendarLinkRecord[];
    getAll(tenantId?: string): CalendarLinkRecord[];
    getById(id: number): CalendarLinkRecord | undefined;
    create(jid: string, calendarId: string, displayName?: string, tenantId?: string): number;
    update(id: number, fields: Partial<Pick<CalendarLinkRecord, 'display_name' | 'is_default' | 'daily_summary' | 'reminder_minutes'>>): boolean;
    delete(id: number): boolean;
}
