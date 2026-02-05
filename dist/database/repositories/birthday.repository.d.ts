export interface BirthdayRecord {
    id: number;
    jid: string;
    person_name: string;
    birth_day: number;
    birth_month: number;
    custom_message?: string | null;
    last_sent_year?: number | null;
    created_at?: string;
}
export declare class BirthdayRepository {
    private db;
    create(input: {
        jid: string;
        person_name: string;
        birth_day: number;
        birth_month: number;
        custom_message?: string;
    }): number;
    findByDate(day: number, month: number): BirthdayRecord[];
    findByJid(jid: string): BirthdayRecord[];
    findById(id: number): BirthdayRecord | undefined;
    getAll(): BirthdayRecord[];
    markSent(id: number, year: number): void;
    delete(id: number): boolean;
    count(): number;
}
