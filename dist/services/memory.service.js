import { promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';
import { logger } from '../utils/logger.js';
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
export class MemoryService {
    root;
    constructor(rootDir = './data/memory/owner') {
        this.root = resolve(rootDir);
    }
    async ensureLayout() {
        await fs.mkdir(join(this.root, 'daily'), { recursive: true });
        await fs.mkdir(join(this.root, 'people'), { recursive: true });
        await fs.mkdir(join(this.root, 'projects'), { recursive: true });
        const corePath = join(this.root, 'core.md');
        try {
            await fs.access(corePath);
        }
        catch {
            await fs.writeFile(corePath, DEFAULT_CORE, 'utf-8');
            logger.info(`MemoryService seeded core.md at ${corePath}`);
        }
        const soulPath = join(this.root, 'soul.md');
        try {
            await fs.access(soulPath);
        }
        catch {
            await fs.writeFile(soulPath, DEFAULT_SOUL, 'utf-8');
            logger.info(`MemoryService seeded soul.md at ${soulPath}`);
        }
    }
    async readSoul() {
        try {
            return await fs.readFile(join(this.root, 'soul.md'), 'utf-8');
        }
        catch {
            return DEFAULT_SOUL;
        }
    }
    async readCore() {
        try {
            return await fs.readFile(join(this.root, 'core.md'), 'utf-8');
        }
        catch {
            return DEFAULT_CORE;
        }
    }
    async writeCore(content) {
        await this.atomicWrite(join(this.root, 'core.md'), content);
    }
    /** Apply a section patch: replace or append section under "## <heading>". */
    async patchCoreSection(section, body) {
        const current = await this.readCore();
        const heading = `## ${section}`;
        const lines = current.split(/\r?\n/);
        const startIdx = lines.findIndex(l => l.trim() === heading);
        if (startIdx === -1) {
            const sep = current.endsWith('\n') ? '' : '\n';
            await this.writeCore(`${current}${sep}\n${heading}\n${body.trimEnd()}\n`);
            return;
        }
        let endIdx = lines.length;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].startsWith('## ')) {
                endIdx = i;
                break;
            }
        }
        const before = lines.slice(0, startIdx + 1).join('\n');
        const after = lines.slice(endIdx).join('\n');
        const newSection = `${before}\n${body.trimEnd()}\n${after.startsWith('\n') || after === '' ? '' : '\n'}${after}`;
        await this.writeCore(newSection.replace(/\n{3,}/g, '\n\n'));
    }
    /** Append (or replace) a fact line under the section. Idempotent for identical lines. */
    async addFact(section, line) {
        const current = await this.readCore();
        const heading = `## ${section}`;
        const trimmedLine = line.trim().startsWith('-') ? line.trim() : `- ${line.trim()}`;
        if (current.includes(trimmedLine))
            return; // already present
        const lines = current.split(/\r?\n/);
        const startIdx = lines.findIndex(l => l.trim() === heading);
        if (startIdx === -1) {
            const sep = current.endsWith('\n') ? '' : '\n';
            await this.writeCore(`${current}${sep}\n${heading}\n${trimmedLine}\n`);
            return;
        }
        let insertAt = lines.length;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].startsWith('## ')) {
                insertAt = i;
                break;
            }
        }
        lines.splice(insertAt, 0, trimmedLine);
        await this.writeCore(lines.join('\n'));
    }
    // --- Daily notes ---
    dailyPath(date = new Date()) {
        const d = new Date(date);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return join(this.root, 'daily', `${iso}.md`);
    }
    async appendDailyNote(text, date = new Date()) {
        const path = this.dailyPath(date);
        const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        const existing = await this.safeRead(path);
        const block = existing ? `${existing.trimEnd()}\n\n${time} — ${text}\n` : `# ${path.split(/[\\/]/).pop()?.replace('.md', '')}\n\n${time} — ${text}\n`;
        await this.atomicWrite(path, block);
    }
    async readRecentDaily(days = 2) {
        const out = [];
        const now = new Date();
        for (let i = 0; i < days; i++) {
            const d = new Date(now.getTime() - i * 24 * 3600 * 1000);
            const txt = await this.safeRead(this.dailyPath(d));
            if (txt)
                out.push(txt.trim());
        }
        return out.join('\n\n---\n\n');
    }
    // --- People & projects (on-demand) ---
    slug(s) {
        return s.toLowerCase().trim().replace(/[^a-z0-9א-ת]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    }
    async listPeople() { return this.listDir('people'); }
    async listProjects() { return this.listDir('projects'); }
    async readPerson(slugOrName) {
        return this.readEntity('people', slugOrName);
    }
    async readProject(slugOrName) {
        return this.readEntity('projects', slugOrName);
    }
    async appendPersonNote(slugOrName, note) {
        return this.appendEntityNote('people', slugOrName, note);
    }
    async appendProjectNote(slugOrName, note) {
        return this.appendEntityNote('projects', slugOrName, note);
    }
    /** Substring search across people + projects (no embeddings; small corpus). Returns matched filename + first 200 chars. */
    async search(query, category) {
        const cats = category ? [category] : ['people', 'projects'];
        const q = query.toLowerCase();
        const out = [];
        for (const cat of cats) {
            const files = await this.listDir(cat);
            for (const slug of files) {
                const content = (await this.safeRead(join(this.root, cat, `${slug}.md`))) || '';
                if (slug.toLowerCase().includes(q) || content.toLowerCase().includes(q)) {
                    out.push({ category: cat, slug, excerpt: content.slice(0, 400) });
                }
            }
        }
        return out;
    }
    // --- Internals ---
    async listDir(sub) {
        try {
            const entries = await fs.readdir(join(this.root, sub));
            return entries.filter(e => e.endsWith('.md')).map(e => e.replace(/\.md$/, ''));
        }
        catch {
            return [];
        }
    }
    async readEntity(cat, slugOrName) {
        const slug = this.slug(slugOrName);
        return this.safeRead(join(this.root, cat, `${slug}.md`));
    }
    async appendEntityNote(cat, slugOrName, note) {
        const slug = this.slug(slugOrName);
        const path = join(this.root, cat, `${slug}.md`);
        const existing = await this.safeRead(path);
        const stamp = new Date().toISOString().slice(0, 10);
        const block = existing
            ? `${existing.trimEnd()}\n\n${stamp} — ${note}\n`
            : `# ${slugOrName}\n\n${stamp} — ${note}\n`;
        await this.atomicWrite(path, block);
        return slug;
    }
    async safeRead(path) {
        try {
            return await fs.readFile(path, 'utf-8');
        }
        catch {
            return null;
        }
    }
    async atomicWrite(path, content) {
        await fs.mkdir(dirname(path), { recursive: true });
        const tmp = `${path}.tmp-${process.pid}`;
        await fs.writeFile(tmp, content, 'utf-8');
        await fs.rename(tmp, path);
    }
}
const DEFAULT_SOUL = `# Itai's Executive Assistant — Soul

## Identity
You are Itai's executive assistant. Hebrew by default. Terse, no filler. Concise replies (≤150 words). Never auto-generate images unless he explicitly invokes /image or /proimage.

## Execute-First Principle (CRITICAL)
For self-contained text tasks — translate, rephrase, summarize, rewrite, proofread, compose text, grammar-fix — JUST DO THE TASK. The name in the task is content, not a lookup key. Do NOT call search_memory for names that appear inside content-generation requests.

Ask for clarification ONLY when ambiguity genuinely blocks execution (e.g., two people in memory share the same name; you don't know which calendar to use). Itai prefers execution over questions. One-shot if you can; question only if you must.

If Itai gives a correction ("אל תתחכם", "לא, התכוונתי...", "ספציפית ביקשתי..."), re-read the ORIGINAL request — not just the correction — and execute what was originally asked.

## Tool Use
When asked anything that maps to a tool (mail, calendar, tasks, memory), CALL THE TOOL — never guess, never say "I don't have access".

Messages in [brackets] in conversation history are records of actions you performed; trust them.

## Email Drafting Rules (draft_new_email / gmail_draft_reply)

1. CREATE the content; do NOT transcribe the instruction. When Itai describes WHAT the email should contain ("write a poem", "summarize Q3", "invite him to dinner"), you must PRODUCE that content — write the poem, write the summary, write the invitation. Do not put Itai's meta-instruction into the body.
   - Instruction "בגוף כתוב שיר יפה ומרגש" → body must be an actual 4–8 line poem, not the literal string "שיר יפה ומרגש".

2. Before drafting to a named recipient (new or reply), first call gmail_list_recent_emails with q="from:<email> OR to:<email>" (max=5) to inspect recent thread context. If a relevant prior thread exists on the same topic, prefer gmail_draft_reply over draft_new_email.

3. Register: business contact → polite, direct, professional, no emojis. Family/close friend → warm, personal, emojis OK if the thread uses them.

4. Language: match recipient's last correspondence. If none, use Itai's instruction language for personal recipients; default to professional English for business contacts unless he specified otherwise. Hebrew recipients → Hebrew.

5. Structure — ALWAYS include all four parts, even for short/creative emails:
   a. Subject: specific and meaningful (not "Update", not a transcription of the instruction).
   b. Greeting by first name: "Dear <FirstName>,", "היי <שם>,", "אסתר שלי," for intimate cases.
   c. Body: the actual generated content (paragraphs separated by blank lines).
   d. Closing + signature: closing line + blank line + signature from core memory ("## Email signature"). NEVER skip the signature.

6. After creating the draft, the WhatsApp confirmation (with link) is sent automatically — do NOT also send a text summary yourself.

## Memory Curation
When Itai reveals a durable preference, identity detail, or active project, call update_core_memory. After meetings or when context is shared about a person/project, call append_person_note / append_project_note.
`;
const DEFAULT_CORE = `# Itai — Core Memory

## Identity
- Name: Itai Kuperstoch
- Email: itaikuper@gmail.com
- WhatsApp: 0527994140 (JID: 161001731264547@lid)
- Timezone: Asia/Jerusalem
- Primary language: Hebrew

## Preferences
- Replies in Hebrew, terse and direct, no filler
- No images unless explicitly asked via /image or /proimage

## Active projects
- KAMINER / Amiggi
- KAMINER / LATAM_Perseus

## Key people
- Assaf Kaminer <kaminer@hotmail.com>

## Standing instructions
- After fixing anything, push to git and deploy to GCE (~/bot or git pull && pm2 restart bayles)

## Email signature
Best regards,
Itai Kuperstoch
`;
let instance = null;
export function getMemoryService() {
    if (!instance)
        instance = new MemoryService();
    return instance;
}
