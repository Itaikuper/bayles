export interface MessageRecord {
    id?: number;
    jid: string;
    direction: 'incoming' | 'outgoing';
    message: string;
    sender?: string;
    timestamp?: string;
    is_group?: number;
}
export declare class MessageRepository {
    private db;
    create(record: MessageRecord): number;
    findByJid(jid: string, limit?: number, offset?: number): MessageRecord[];
    findAll(limit?: number, offset?: number): MessageRecord[];
    countToday(): number;
    count(): number;
}
