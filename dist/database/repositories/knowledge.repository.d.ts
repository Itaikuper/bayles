export interface KnowledgeItem {
    id: number;
    jid: string;
    title: string;
    content: string;
    category: string;
    created_at: string;
    updated_at: string;
}
export interface CreateKnowledgeItem {
    jid: string;
    title: string;
    content: string;
    category?: string;
}
export interface UpdateKnowledgeItem {
    title?: string;
    content?: string;
    category?: string;
}
export declare class KnowledgeRepository {
    private db;
    getByJid(jid: string): KnowledgeItem[];
    getById(id: number): KnowledgeItem | null;
    create(input: CreateKnowledgeItem): KnowledgeItem;
    update(id: number, updates: UpdateKnowledgeItem): KnowledgeItem | null;
    delete(id: number): boolean;
    deleteByJid(jid: string): number;
    getFormattedKnowledge(jid: string): string;
}
export declare function getKnowledgeRepository(): KnowledgeRepository;
