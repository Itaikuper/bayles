import { getDatabase } from '../db.js';
export class KnowledgeRepository {
    db = getDatabase();
    getByJid(jid) {
        return this.db
            .prepare('SELECT * FROM knowledge_items WHERE jid = ? ORDER BY category, title')
            .all(jid);
    }
    getById(id) {
        const row = this.db
            .prepare('SELECT * FROM knowledge_items WHERE id = ?')
            .get(id);
        return row ?? null;
    }
    create(input) {
        this.db
            .prepare(`INSERT INTO knowledge_items (jid, title, content, category)
         VALUES (?, ?, ?, ?)`)
            .run(input.jid, input.title, input.content, input.category || 'general');
        const id = this.db.prepare('SELECT last_insert_rowid() as id').get();
        return this.getById(id.id);
    }
    update(id, updates) {
        const fields = [];
        const values = [];
        if (updates.title !== undefined) {
            fields.push('title = ?');
            values.push(updates.title);
        }
        if (updates.content !== undefined) {
            fields.push('content = ?');
            values.push(updates.content);
        }
        if (updates.category !== undefined) {
            fields.push('category = ?');
            values.push(updates.category);
        }
        if (fields.length === 0)
            return this.getById(id);
        fields.push("updated_at = datetime('now')");
        values.push(id);
        this.db
            .prepare(`UPDATE knowledge_items SET ${fields.join(', ')} WHERE id = ?`)
            .run(...values);
        return this.getById(id);
    }
    delete(id) {
        const result = this.db
            .prepare('DELETE FROM knowledge_items WHERE id = ?')
            .run(id);
        return result.changes > 0;
    }
    deleteByJid(jid) {
        const result = this.db
            .prepare('DELETE FROM knowledge_items WHERE jid = ?')
            .run(jid);
        return result.changes;
    }
    getFormattedKnowledge(jid) {
        const items = this.getByJid(jid);
        if (items.length === 0)
            return '';
        const formatted = items.map(item => `### ${item.title}\n${item.content}`).join('\n\n');
        return `\n\n## מאגר ידע\n${formatted}`;
    }
}
let repositoryInstance = null;
export function getKnowledgeRepository() {
    if (!repositoryInstance) {
        repositoryInstance = new KnowledgeRepository();
    }
    return repositoryInstance;
}
