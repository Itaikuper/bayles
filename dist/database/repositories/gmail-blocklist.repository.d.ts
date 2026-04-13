export declare function getGmailBlocklistRepository(): GmailBlocklistRepository;
/**
 * Stores substrings that the owner has chosen to suppress from the personal-inbox pass.
 * Patterns are lowercased; match is a case-insensitive substring check against the raw From header.
 * Examples: "bezeq", "@iec.co.il", "marketing@partner.co.il".
 */
export declare class GmailBlocklistRepository {
    add(jid: string, pattern: string): void;
    remove(jid: string, pattern: string): number;
    list(jid: string): string[];
    matches(jid: string, fromHeader: string): boolean;
}
