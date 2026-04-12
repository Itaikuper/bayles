export interface GmailCredentialRecord {
    jid: string;
    refresh_token_enc: string;
    email_address: string;
    scopes: string;
    created_at: number;
    updated_at: number;
}
export interface GmailWatchLabel {
    jid: string;
    label_id: string;
    label_name: string;
}
export declare function getGmailRepository(): GmailRepository;
export declare class GmailRepository {
    saveCredentials(rec: Omit<GmailCredentialRecord, 'created_at' | 'updated_at'>): void;
    getCredentials(jid: string): GmailCredentialRecord | undefined;
    deleteCredentials(jid: string): void;
    addWatchLabel(jid: string, labelId: string, labelName: string): void;
    removeWatchLabelByName(jid: string, labelName: string): number;
    listWatchLabels(jid: string): GmailWatchLabel[];
    isSeen(jid: string, messageId: string): boolean;
    markSeen(jid: string, messageId: string): void;
    pruneSeen(olderThanMs: number): number;
}
