import { getDatabase } from './db.js';
import { logger } from '../utils/logger.js';

export function runMigrations(): void {
  const db = getDatabase();

  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Check if initial migration already applied
  const applied = db.prepare('SELECT name FROM migrations WHERE name = ?').get('001_initial');

  if (!applied) {
    logger.info('Running migration: 001_initial');

    // Message history table
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('incoming', 'outgoing')),
        message TEXT NOT NULL,
        sender TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_group INTEGER DEFAULT 0
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_jid ON messages(jid)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)`);

    // Scheduled messages table
    db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_messages (
        id TEXT PRIMARY KEY,
        jid TEXT NOT NULL,
        message TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        one_time INTEGER DEFAULT 0,
        scheduled_at TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        active INTEGER DEFAULT 1
      )
    `);

    // AI settings table
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Mark migration as applied
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('001_initial');
    logger.info('Migration 001_initial completed');
  }

  // Phase 3: Bot Control System migration
  const applied002 = db.prepare('SELECT name FROM migrations WHERE name = ?').get('002_bot_control');

  if (!applied002) {
    logger.info('Running migration: 002_bot_control');

    // Global bot settings table
    db.exec(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default settings
    db.exec(`
      INSERT OR IGNORE INTO bot_settings (key, value) VALUES
        ('bot_enabled', 'false'),
        ('default_behavior', 'silent'),
        ('log_all_messages', 'true')
    `);

    // Per-chat configuration (whitelist)
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_configs (
        jid TEXT PRIMARY KEY,
        display_name TEXT,
        is_group INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 0,
        ai_mode TEXT DEFAULT 'off' CHECK(ai_mode IN ('on', 'off')),
        custom_prompt TEXT,
        auto_reply_message TEXT,
        schedule_enabled INTEGER DEFAULT 0,
        schedule_start_hour INTEGER DEFAULT 0,
        schedule_end_hour INTEGER DEFAULT 24,
        schedule_days TEXT DEFAULT '0,1,2,3,4,5,6',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_configs_enabled ON chat_configs(enabled)`);

    // Activity log table
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT NOT NULL,
        sender TEXT,
        message TEXT NOT NULL,
        is_group INTEGER DEFAULT 0,
        response_status TEXT DEFAULT 'ignored' CHECK(response_status IN ('ignored', 'responded', 'auto_reply')),
        reason TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_log_jid ON activity_log(jid)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log(timestamp)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_log_status ON activity_log(response_status)`);

    // Mark migration as applied
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('002_bot_control');
    logger.info('Migration 002_bot_control completed');
  }

  // Migration 003: Add AI support to scheduled messages
  const applied003 = db.prepare('SELECT name FROM migrations WHERE name = ?').get('003_scheduler_ai');

  if (!applied003) {
    logger.info('Running migration: 003_scheduler_ai');

    db.exec(`ALTER TABLE scheduled_messages ADD COLUMN use_ai INTEGER DEFAULT 0`);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('003_scheduler_ai');
    logger.info('Migration 003_scheduler_ai completed');
  }

  // Migration 004: Birthday reminders
  const applied004 = db.prepare('SELECT name FROM migrations WHERE name = ?').get('004_birthdays');

  if (!applied004) {
    logger.info('Running migration: 004_birthdays');

    db.exec(`
      CREATE TABLE IF NOT EXISTS birthdays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT NOT NULL,
        person_name TEXT NOT NULL,
        birth_day INTEGER NOT NULL CHECK(birth_day >= 1 AND birth_day <= 31),
        birth_month INTEGER NOT NULL CHECK(birth_month >= 1 AND birth_month <= 12),
        custom_message TEXT,
        last_sent_year INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_birthdays_jid ON birthdays(jid)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_birthdays_date ON birthdays(birth_month, birth_day)`);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('004_birthdays');
    logger.info('Migration 004_birthdays completed');
  }

  // Migration 005: Knowledge base for per-chat context
  const applied005 = db.prepare('SELECT name FROM migrations WHERE name = ?').get('005_knowledge_base');

  if (!applied005) {
    logger.info('Running migration: 005_knowledge_base');

    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_knowledge_items_jid ON knowledge_items(jid)`);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('005_knowledge_base');
    logger.info('Migration 005_knowledge_base completed');
  }
}
