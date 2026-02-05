import { getDatabase } from '../db.js';
export class ChatConfigRepository {
    db = getDatabase();
    getAll() {
        return this.db
            .prepare('SELECT * FROM chat_configs ORDER BY display_name')
            .all();
    }
    getAllEnabled() {
        return this.db
            .prepare('SELECT * FROM chat_configs WHERE enabled = 1 ORDER BY display_name')
            .all();
    }
    getByJid(jid) {
        const row = this.db
            .prepare('SELECT * FROM chat_configs WHERE jid = ?')
            .get(jid);
        return row ?? null;
    }
    isEnabled(jid) {
        const config = this.getByJid(jid);
        return config?.enabled === 1;
    }
    create(config) {
        this.db
            .prepare(`INSERT INTO chat_configs (
          jid, display_name, is_group, enabled, ai_mode,
          custom_prompt, auto_reply_message, schedule_enabled,
          schedule_start_hour, schedule_end_hour, schedule_days
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(config.jid, config.display_name ?? null, config.is_group ? 1 : 0, config.enabled ? 1 : 0, config.ai_mode ?? 'off', config.custom_prompt ?? null, config.auto_reply_message ?? null, config.schedule_enabled ? 1 : 0, config.schedule_start_hour ?? 0, config.schedule_end_hour ?? 24, config.schedule_days ?? '0,1,2,3,4,5,6');
        return this.getByJid(config.jid);
    }
    update(jid, updates) {
        const fields = [];
        const values = [];
        if (updates.display_name !== undefined) {
            fields.push('display_name = ?');
            values.push(updates.display_name);
        }
        if (updates.enabled !== undefined) {
            fields.push('enabled = ?');
            values.push(updates.enabled ? 1 : 0);
        }
        if (updates.ai_mode !== undefined) {
            fields.push('ai_mode = ?');
            values.push(updates.ai_mode);
        }
        if (updates.custom_prompt !== undefined) {
            fields.push('custom_prompt = ?');
            values.push(updates.custom_prompt);
        }
        if (updates.auto_reply_message !== undefined) {
            fields.push('auto_reply_message = ?');
            values.push(updates.auto_reply_message);
        }
        if (updates.schedule_enabled !== undefined) {
            fields.push('schedule_enabled = ?');
            values.push(updates.schedule_enabled ? 1 : 0);
        }
        if (updates.schedule_start_hour !== undefined) {
            fields.push('schedule_start_hour = ?');
            values.push(updates.schedule_start_hour);
        }
        if (updates.schedule_end_hour !== undefined) {
            fields.push('schedule_end_hour = ?');
            values.push(updates.schedule_end_hour);
        }
        if (updates.schedule_days !== undefined) {
            fields.push('schedule_days = ?');
            values.push(updates.schedule_days);
        }
        if (fields.length === 0)
            return this.getByJid(jid);
        fields.push("updated_at = datetime('now')");
        values.push(jid);
        this.db
            .prepare(`UPDATE chat_configs SET ${fields.join(', ')} WHERE jid = ?`)
            .run(...values);
        return this.getByJid(jid);
    }
    delete(jid) {
        const result = this.db
            .prepare('DELETE FROM chat_configs WHERE jid = ?')
            .run(jid);
        return result.changes > 0;
    }
    setEnabled(jid, enabled) {
        this.db
            .prepare("UPDATE chat_configs SET enabled = ?, updated_at = datetime('now') WHERE jid = ?")
            .run(enabled ? 1 : 0, jid);
    }
    isWithinSchedule(jid) {
        const config = this.getByJid(jid);
        if (!config || !config.schedule_enabled)
            return true;
        const now = new Date();
        const currentHour = now.getHours();
        const currentDay = now.getDay();
        const allowedDays = config.schedule_days.split(',').map(Number);
        if (!allowedDays.includes(currentDay))
            return false;
        if (currentHour < config.schedule_start_hour || currentHour >= config.schedule_end_hour) {
            return false;
        }
        return true;
    }
}
let repositoryInstance = null;
export function getChatConfigRepository() {
    if (!repositoryInstance) {
        repositoryInstance = new ChatConfigRepository();
    }
    return repositoryInstance;
}
