import { getDatabase } from '../db.js';
export class BotSettingsRepository {
    db = getDatabase();
    get(key) {
        const row = this.db
            .prepare('SELECT value FROM bot_settings WHERE key = ?')
            .get(key);
        return row?.value ?? null;
    }
    set(key, value) {
        this.db
            .prepare(`INSERT OR REPLACE INTO bot_settings (key, value, updated_at)
         VALUES (?, ?, datetime('now'))`)
            .run(key, value);
    }
    getAll() {
        return this.db
            .prepare('SELECT key, value, updated_at FROM bot_settings')
            .all();
    }
    isBotEnabled() {
        return this.get('bot_enabled') === 'true';
    }
    setBotEnabled(enabled) {
        this.set('bot_enabled', enabled ? 'true' : 'false');
    }
    getDefaultBehavior() {
        return this.get('default_behavior') || 'silent';
    }
    shouldLogAllMessages() {
        return this.get('log_all_messages') !== 'false';
    }
}
let repositoryInstance = null;
export function getBotSettingsRepository() {
    if (!repositoryInstance) {
        repositoryInstance = new BotSettingsRepository();
    }
    return repositoryInstance;
}
