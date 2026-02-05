export declare class CalendarService {
    private calendar;
    private calendarId;
    constructor();
    createEvent(params: {
        summary: string;
        start_datetime: string;
        end_datetime: string;
        location?: string;
        description?: string;
    }): Promise<Record<string, unknown>>;
    listEvents(params: {
        time_min?: string;
        time_max?: string;
        max_results?: number;
    }): Promise<Record<string, unknown>>;
    updateEvent(params: {
        event_id: string;
        summary?: string;
        start_datetime?: string;
        end_datetime?: string;
        location?: string;
        description?: string;
    }): Promise<Record<string, unknown>>;
    deleteEvent(params: {
        event_id: string;
    }): Promise<Record<string, unknown>>;
    executeFunction(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
}
