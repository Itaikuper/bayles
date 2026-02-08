import { getDatabase } from '../db.js';
const MAX_FACTS_PER_USER = 30;
export class UserMemoryRepository {
    db = getDatabase();
    getByJid(jid, tenantId = 'default') {
        return this.db
            .prepare('SELECT * FROM user_memories WHERE jid = ? AND tenant_id = ? ORDER BY updated_at DESC')
            .all(jid, tenantId);
    }
    create(jid, fact, category = 'personal', tenantId = 'default') {
        this.db
            .prepare('INSERT INTO user_memories (jid, fact, category, tenant_id) VALUES (?, ?, ?, ?)')
            .run(jid, fact, category, tenantId);
        const id = this.db.prepare('SELECT last_insert_rowid() as id').get();
        // Enforce max facts limit - delete oldest
        const count = this.db
            .prepare('SELECT COUNT(*) as cnt FROM user_memories WHERE jid = ? AND tenant_id = ?')
            .get(jid, tenantId);
        if (count.cnt > MAX_FACTS_PER_USER) {
            this.db
                .prepare(`DELETE FROM user_memories WHERE id IN (
            SELECT id FROM user_memories WHERE jid = ? AND tenant_id = ?
            ORDER BY updated_at ASC LIMIT ?
          )`)
                .run(jid, tenantId, count.cnt - MAX_FACTS_PER_USER);
        }
        return this.db.prepare('SELECT * FROM user_memories WHERE id = ?').get(id.id);
    }
    update(id, fact) {
        this.db
            .prepare("UPDATE user_memories SET fact = ?, updated_at = datetime('now') WHERE id = ?")
            .run(fact, id);
    }
    delete(id) {
        const result = this.db.prepare('DELETE FROM user_memories WHERE id = ?').run(id);
        return result.changes > 0;
    }
    deleteByJid(jid, tenantId = 'default') {
        const result = this.db
            .prepare('DELETE FROM user_memories WHERE jid = ? AND tenant_id = ?')
            .run(jid, tenantId);
        return result.changes;
    }
    getFormattedMemories(jid, tenantId = 'default') {
        const items = this.getByJid(jid, tenantId);
        if (items.length === 0)
            return '';
        const formatted = items.map(item => `- ${item.fact}`).join('\n');
        return `\n\n## מה שאני יודע על המשתמש הזה:\n${formatted}`;
    }
}
let repositoryInstance = null;
export function getUserMemoryRepository() {
    if (!repositoryInstance) {
        repositoryInstance = new UserMemoryRepository();
    }
    return repositoryInstance;
}
