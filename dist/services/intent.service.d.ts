export type OwnerIntent = 'email_new' | 'calendar_list' | 'calendar_create' | 'general';
export interface ClassifiedIntent {
    intent: OwnerIntent;
    slots: {
        recipient_hint?: string;
        subject_hint?: string;
        topic_hint?: string;
        date_phrase?: string;
        time_phrase?: string;
        summary_hint?: string;
        duration_phrase?: string;
        calendar_hint?: string;
        query_hint?: string;
    };
    reasoning?: string;
}
export declare class IntentService {
    private ai;
    constructor();
    classify(userMessage: string): Promise<ClassifiedIntent>;
}
export declare function getIntentService(): IntentService;
