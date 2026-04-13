import { promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';
import { logger } from '../utils/logger.js';

/**
 * Markdown-on-disk memory store inspired by OpenClaw.
 *
 * Layout:
 *   data/memory/owner/
 *     ├─ core.md          ~100 lines, ALWAYS injected into system prompt
 *     ├─ daily/YYYY-MM-DD.md  auto-appended notes per day; today + yesterday loaded
 *     ├─ people/<slug>.md  on-demand via search_memory
 *     └─ projects/<slug>.md  on-demand via search_memory
 */
export class MemoryService {
  private readonly root: string;

  constructor(rootDir: string = './data/memory/owner') {
    this.root = resolve(rootDir);
  }

  async ensureLayout(): Promise<void> {
    await fs.mkdir(join(this.root, 'daily'), { recursive: true });
    await fs.mkdir(join(this.root, 'people'), { recursive: true });
    await fs.mkdir(join(this.root, 'projects'), { recursive: true });
    const corePath = join(this.root, 'core.md');
    try {
      await fs.access(corePath);
    } catch {
      await fs.writeFile(corePath, DEFAULT_CORE, 'utf-8');
      logger.info(`MemoryService seeded core.md at ${corePath}`);
    }
  }

  async readCore(): Promise<string> {
    try {
      return await fs.readFile(join(this.root, 'core.md'), 'utf-8');
    } catch {
      return DEFAULT_CORE;
    }
  }

  async writeCore(content: string): Promise<void> {
    await this.atomicWrite(join(this.root, 'core.md'), content);
  }

  /** Apply a section patch: replace or append section under "## <heading>". */
  async patchCoreSection(section: string, body: string): Promise<void> {
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
      if (lines[i].startsWith('## ')) { endIdx = i; break; }
    }
    const before = lines.slice(0, startIdx + 1).join('\n');
    const after = lines.slice(endIdx).join('\n');
    const newSection = `${before}\n${body.trimEnd()}\n${after.startsWith('\n') || after === '' ? '' : '\n'}${after}`;
    await this.writeCore(newSection.replace(/\n{3,}/g, '\n\n'));
  }

  /** Append (or replace) a fact line under the section. Idempotent for identical lines. */
  async addFact(section: string, line: string): Promise<void> {
    const current = await this.readCore();
    const heading = `## ${section}`;
    const trimmedLine = line.trim().startsWith('-') ? line.trim() : `- ${line.trim()}`;
    if (current.includes(trimmedLine)) return; // already present
    const lines = current.split(/\r?\n/);
    const startIdx = lines.findIndex(l => l.trim() === heading);
    if (startIdx === -1) {
      const sep = current.endsWith('\n') ? '' : '\n';
      await this.writeCore(`${current}${sep}\n${heading}\n${trimmedLine}\n`);
      return;
    }
    let insertAt = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) { insertAt = i; break; }
    }
    lines.splice(insertAt, 0, trimmedLine);
    await this.writeCore(lines.join('\n'));
  }

  // --- Daily notes ---

  private dailyPath(date: Date = new Date()): string {
    const d = new Date(date);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return join(this.root, 'daily', `${iso}.md`);
  }

  async appendDailyNote(text: string, date: Date = new Date()): Promise<void> {
    const path = this.dailyPath(date);
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const existing = await this.safeRead(path);
    const block = existing ? `${existing.trimEnd()}\n\n${time} — ${text}\n` : `# ${path.split(/[\\/]/).pop()?.replace('.md', '')}\n\n${time} — ${text}\n`;
    await this.atomicWrite(path, block);
  }

  async readRecentDaily(days: number = 2): Promise<string> {
    const out: string[] = [];
    const now = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(now.getTime() - i * 24 * 3600 * 1000);
      const txt = await this.safeRead(this.dailyPath(d));
      if (txt) out.push(txt.trim());
    }
    return out.join('\n\n---\n\n');
  }

  // --- People & projects (on-demand) ---

  private slug(s: string): string {
    return s.toLowerCase().trim().replace(/[^a-z0-9א-ת]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  async listPeople(): Promise<string[]> { return this.listDir('people'); }
  async listProjects(): Promise<string[]> { return this.listDir('projects'); }

  async readPerson(slugOrName: string): Promise<string | null> {
    return this.readEntity('people', slugOrName);
  }
  async readProject(slugOrName: string): Promise<string | null> {
    return this.readEntity('projects', slugOrName);
  }

  async appendPersonNote(slugOrName: string, note: string): Promise<string> {
    return this.appendEntityNote('people', slugOrName, note);
  }
  async appendProjectNote(slugOrName: string, note: string): Promise<string> {
    return this.appendEntityNote('projects', slugOrName, note);
  }

  /** Substring search across people + projects (no embeddings; small corpus). Returns matched filename + first 200 chars. */
  async search(query: string, category?: 'people' | 'projects'): Promise<{ category: string; slug: string; excerpt: string }[]> {
    const cats: ('people' | 'projects')[] = category ? [category] : ['people', 'projects'];
    const q = query.toLowerCase();
    const out: { category: string; slug: string; excerpt: string }[] = [];
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

  private async listDir(sub: 'people' | 'projects' | 'daily'): Promise<string[]> {
    try {
      const entries = await fs.readdir(join(this.root, sub));
      return entries.filter(e => e.endsWith('.md')).map(e => e.replace(/\.md$/, ''));
    } catch { return []; }
  }

  private async readEntity(cat: 'people' | 'projects', slugOrName: string): Promise<string | null> {
    const slug = this.slug(slugOrName);
    return this.safeRead(join(this.root, cat, `${slug}.md`));
  }

  private async appendEntityNote(cat: 'people' | 'projects', slugOrName: string, note: string): Promise<string> {
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

  private async safeRead(path: string): Promise<string | null> {
    try { return await fs.readFile(path, 'utf-8'); } catch { return null; }
  }

  private async atomicWrite(path: string, content: string): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    await fs.writeFile(tmp, content, 'utf-8');
    await fs.rename(tmp, path);
  }
}

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

let instance: MemoryService | null = null;
export function getMemoryService(): MemoryService {
  if (!instance) instance = new MemoryService();
  return instance;
}
