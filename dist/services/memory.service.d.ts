/**
 * Markdown-on-disk memory store inspired by OpenClaw + Hermes.
 *
 * Layout:
 *   data/memory/owner/
 *     ├─ soul.md          personality/identity + execute-first directive (ALWAYS injected)
 *     ├─ core.md          ~100 lines of facts, ALWAYS injected into system prompt
 *     ├─ daily/YYYY-MM-DD.md  auto-appended notes per day; today + yesterday loaded
 *     ├─ people/<slug>.md  on-demand via search_memory
 *     └─ projects/<slug>.md  on-demand via search_memory
 */
export declare class MemoryService {
    private readonly root;
    constructor(rootDir?: string);
    ensureLayout(): Promise<void>;
    readSoul(): Promise<string>;
    readCore(): Promise<string>;
    writeCore(content: string): Promise<void>;
    /** Apply a section patch: replace or append section under "## <heading>". */
    patchCoreSection(section: string, body: string): Promise<void>;
    /** Append (or replace) a fact line under the section. Idempotent for identical lines. */
    addFact(section: string, line: string): Promise<void>;
    private dailyPath;
    appendDailyNote(text: string, date?: Date): Promise<void>;
    readRecentDaily(days?: number): Promise<string>;
    private slug;
    listPeople(): Promise<string[]>;
    listProjects(): Promise<string[]>;
    readPerson(slugOrName: string): Promise<string | null>;
    readProject(slugOrName: string): Promise<string | null>;
    appendPersonNote(slugOrName: string, note: string): Promise<string>;
    appendProjectNote(slugOrName: string, note: string): Promise<string>;
    /** Substring search across people + projects (no embeddings; small corpus). Returns matched filename + first 200 chars. */
    search(query: string, category?: 'people' | 'projects'): Promise<{
        category: string;
        slug: string;
        excerpt: string;
    }[]>;
    private listDir;
    private readEntity;
    private appendEntityNote;
    private safeRead;
    private atomicWrite;
}
export declare function getMemoryService(): MemoryService;
