export type OwnerIntent = 'email_new' | 'general';
export interface ClassifiedIntent {
    intent: OwnerIntent;
    slots: {
        recipient_hint?: string;
        subject_hint?: string;
        topic_hint?: string;
    };
    reasoning?: string;
}
export declare class IntentService {
    private ai;
    constructor();
    classify(userMessage: string): Promise<ClassifiedIntent>;
}
export declare function getIntentService(): IntentService;
