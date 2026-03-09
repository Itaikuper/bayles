export interface HoshayaDirectoryRecord {
    id: number;
    first_name: string;
    last_name: string;
    home_phone: string;
    mobile_phone: string;
    address: string;
    created_at: string;
}
export declare class HoshayaDirectoryRepository {
    private db;
    search(query: string, limit?: number): HoshayaDirectoryRecord[];
    getAll(): HoshayaDirectoryRecord[];
    count(): number;
    bulkInsert(entries: {
        first_name: string;
        last_name: string;
        home_phone: string;
        mobile_phone: string;
        address: string;
    }[]): number;
    clear(): void;
}
export declare function getHoshayaDirectoryRepository(): HoshayaDirectoryRepository;
