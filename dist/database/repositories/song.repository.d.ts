export interface SongRecord {
    id: string;
    title: string;
    artist: string;
    url: string;
    capo: number | null;
    tenant_id: string;
}
export declare class SongRepository {
    private db;
    search(query: string, limit?: number): SongRecord[];
    getById(id: string): SongRecord | null;
    getByArtist(artist: string, limit?: number): SongRecord[];
    upsert(song: {
        id: string;
        title: string;
        artist: string;
        url: string;
        capo: number | null;
    }): void;
    count(): number;
}
export declare function getSongRepository(): SongRepository;
