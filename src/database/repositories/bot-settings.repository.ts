import { getDatabase } from '../db.js';

export interface BotSetting {
  key: string;
  value: string;
  updated_at: string;
}

export class BotSettingsRepository {
  private db = getDatabase();

  get(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM bot_settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO bot_settings (key, value, updated_at)
         VALUES (?, ?, datetime('now'))`
      )
      .run(key, value);
  }

  getAll(): BotSetting[] {
    return this.db
      .prepare('SELECT key, value, updated_at FROM bot_settings')
      .all() as BotSetting[];
  }

  isBotEnabled(): boolean {
    return this.get('bot_enabled') === 'true';
  }

  setBotEnabled(enabled: boolean): void {
    this.set('bot_enabled', enabled ? 'true' : 'false');
  }

  getDefaultBehavior(): string {
    return this.get('default_behavior') || 'silent';
  }

  shouldLogAllMessages(): boolean {
    return this.get('log_all_messages') !== 'false';
  }
}

let repositoryInstance: BotSettingsRepository | null = null;

export function getBotSettingsRepository(): BotSettingsRepository {
  if (!repositoryInstance) {
    repositoryInstance = new BotSettingsRepository();
  }
  return repositoryInstance;
}
