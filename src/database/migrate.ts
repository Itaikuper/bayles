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

  // Migration 006: Multi-tenant support
  const applied006 = db.prepare('SELECT name FROM migrations WHERE name = ?').get('006_multi_tenant');

  if (!applied006) {
    logger.info('Running migration: 006_multi_tenant');

    // Create tenants table
    db.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'connecting', 'connected', 'disconnected')),
        system_prompt TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default tenant for backwards compatibility
    db.exec(`
      INSERT OR IGNORE INTO tenants (id, name, status)
      VALUES ('default', 'Default Bot', 'connected')
    `);

    // Add tenant_id to existing tables (SQLite ALTER TABLE doesn't support REFERENCES)
    db.exec(`ALTER TABLE chat_configs ADD COLUMN tenant_id TEXT DEFAULT 'default'`);
    db.exec(`ALTER TABLE knowledge_items ADD COLUMN tenant_id TEXT DEFAULT 'default'`);
    db.exec(`ALTER TABLE scheduled_messages ADD COLUMN tenant_id TEXT DEFAULT 'default'`);
    db.exec(`ALTER TABLE messages ADD COLUMN tenant_id TEXT DEFAULT 'default'`);
    db.exec(`ALTER TABLE activity_log ADD COLUMN tenant_id TEXT DEFAULT 'default'`);
    db.exec(`ALTER TABLE birthdays ADD COLUMN tenant_id TEXT DEFAULT 'default'`);

    // Create indexes for tenant_id
    db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_configs_tenant ON chat_configs(tenant_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_knowledge_items_tenant ON knowledge_items(tenant_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_messages_tenant ON scheduled_messages(tenant_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_log_tenant ON activity_log(tenant_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_birthdays_tenant ON birthdays(tenant_id)`);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('006_multi_tenant');
    logger.info('Migration 006_multi_tenant completed');
  }

  // Migration 007: Songs database + Contacts (phone book)
  const applied007 = db.prepare('SELECT name FROM migrations WHERE name = ?').get('007_songs_contacts');

  if (!applied007) {
    logger.info('Running migration: 007_songs_contacts');

    // Songs table (read-only, imported from PlayAlong)
    db.exec(`
      CREATE TABLE IF NOT EXISTS songs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        url TEXT NOT NULL,
        capo INTEGER,
        tenant_id TEXT DEFAULT 'default' REFERENCES tenants(id)
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_songs_tenant ON songs(tenant_id)`);

    // Contacts table (phone book, managed via dashboard)
    db.exec(`
      CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        notes TEXT,
        category TEXT DEFAULT 'general',
        tenant_id TEXT DEFAULT 'default' REFERENCES tenants(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_tenant ON contacts(tenant_id)`);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('007_songs_contacts');
    logger.info('Migration 007_songs_contacts completed');
  }

  // Migration 008: User memories (persistent per-user facts)
  const applied008 = db.prepare('SELECT name FROM migrations WHERE name = ?').get('008_user_memories');

  if (!applied008) {
    logger.info('Running migration: 008_user_memories');

    db.exec(`
      CREATE TABLE IF NOT EXISTS user_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT NOT NULL,
        fact TEXT NOT NULL,
        category TEXT DEFAULT 'personal',
        tenant_id TEXT DEFAULT 'default',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_memories_jid ON user_memories(jid)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_memories_tenant ON user_memories(tenant_id)`);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('008_user_memories');
    logger.info('Migration 008_user_memories completed');
  }

  // Migration 009: Conversation history persistence + compaction summaries
  const applied009 = db.prepare('SELECT name FROM migrations WHERE name = ?').get('009_conversation_history');

  if (!applied009) {
    logger.info('Running migration: 009_conversation_history');

    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'model')),
        content TEXT NOT NULL,
        tenant_id TEXT DEFAULT 'default',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_history_jid_tenant ON conversation_history(jid, tenant_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_history_created ON conversation_history(created_at)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT NOT NULL,
        summary TEXT NOT NULL,
        message_count INTEGER DEFAULT 0,
        tenant_id TEXT DEFAULT 'default',
        period_start DATETIME,
        period_end DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_summaries_jid_tenant ON conversation_summaries(jid, tenant_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_summaries_created ON conversation_summaries(created_at)`);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('009_conversation_history');
    logger.info('Migration 009_conversation_history completed');
  }

  // Migration 010: Calendar links (Google Calendar integration)
  const applied010 = db.prepare('SELECT name FROM migrations WHERE name = ?').get('010_calendar_links');

  if (!applied010) {
    logger.info('Running migration: 010_calendar_links');

    db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT NOT NULL,
        calendar_id TEXT NOT NULL,
        display_name TEXT,
        is_default INTEGER DEFAULT 1,
        daily_summary INTEGER DEFAULT 0,
        tenant_id TEXT DEFAULT 'default',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(jid, calendar_id)
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_calendar_links_jid ON calendar_links(jid)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_calendar_links_tenant ON calendar_links(tenant_id)`);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('010_calendar_links');
    logger.info('Migration 010_calendar_links completed');
  }

  // Migration 011: Calendar event reminders
  const applied011 = db.prepare('SELECT name FROM migrations WHERE name = ?').get('011_calendar_reminders');

  if (!applied011) {
    logger.info('Running migration: 011_calendar_reminders');

    db.exec(`ALTER TABLE calendar_links ADD COLUMN reminder_minutes INTEGER DEFAULT NULL`);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('011_calendar_reminders');
    logger.info('Migration 011_calendar_reminders completed');
  }

  // Migration 012: Hoshaya village phone directory
  const applied012 = db.prepare('SELECT name FROM migrations WHERE name = ?').get('012_hoshaya_directory');

  if (!applied012) {
    logger.info('Running migration: 012_hoshaya_directory');

    db.exec(`
      CREATE TABLE IF NOT EXISTS hoshaya_directory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        home_phone TEXT DEFAULT '',
        mobile_phone TEXT DEFAULT '',
        address TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_hoshaya_first_name ON hoshaya_directory(first_name)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_hoshaya_last_name ON hoshaya_directory(last_name)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_hoshaya_full_name ON hoshaya_directory(first_name, last_name)`);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('012_hoshaya_directory');
    logger.info('Migration 012_hoshaya_directory completed');
  }

  // Migration 013a: Per-chat privacy controls (allowed_tools + inject_user_memory)
  const applied013a = db.prepare('SELECT name FROM migrations WHERE name = ?').get('013a_chat_privacy');

  if (!applied013a) {
    logger.info('Running migration: 013a_chat_privacy');

    // allowed_tools: JSON array of tool names allowed in this chat (NULL = all tools allowed)
    db.exec(`ALTER TABLE chat_configs ADD COLUMN allowed_tools TEXT DEFAULT NULL`);

    // inject_user_memory: whether to inject per-user memory facts when generating responses
    db.exec(`ALTER TABLE chat_configs ADD COLUMN inject_user_memory INTEGER DEFAULT 1`);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('013a_chat_privacy');
    logger.info('Migration 013a_chat_privacy completed');
  }

  // Migration 013: Chore rotations (family duty scheduling)
  const applied013 = db.prepare('SELECT name FROM migrations WHERE name = ?').get('013_chore_rotations');

  if (!applied013) {
    logger.info('Running migration: 013_chore_rotations');

    db.exec(`
      CREATE TABLE IF NOT EXISTS chore_rotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT NOT NULL,
        name TEXT NOT NULL,
        members TEXT NOT NULL,
        current_index INTEGER DEFAULT 0,
        frequency TEXT DEFAULT 'daily' CHECK(frequency IN ('daily', 'weekly')),
        reminder_hour INTEGER DEFAULT 8,
        reminder_minute INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1,
        last_sent_date TEXT,
        tenant_id TEXT DEFAULT 'default',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(jid, name)
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_chore_rotations_jid ON chore_rotations(jid)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_chore_rotations_active ON chore_rotations(active)`);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('013_chore_rotations');
    logger.info('Migration 013_chore_rotations completed');
  }

  runGmailMigration(db);
  runTasksMigration(db);
  runGmailSendersMigration(db);
}

function runGmailSendersMigration(db: ReturnType<typeof getDatabase>): void {
  const applied = db.prepare('SELECT name FROM migrations WHERE name = ?').get('016_gmail_watch_senders');
  if (applied) return;
  logger.info('Running migration: 016_gmail_watch_senders');
  db.exec(`
    CREATE TABLE IF NOT EXISTS gmail_watch_senders (
      jid TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (jid, email)
    )
  `);
  db.prepare('INSERT INTO migrations (name) VALUES (?)').run('016_gmail_watch_senders');
  logger.info('Migration 016_gmail_watch_senders completed');
}

function runTasksMigration(db: ReturnType<typeof getDatabase>): void {
  const applied = db.prepare('SELECT name FROM migrations WHERE name = ?').get('015_tasks');
  if (applied) return;
  logger.info('Running migration: 015_tasks');

  const tasksTable = `
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jid TEXT NOT NULL,
      title TEXT NOT NULL,
      notes TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','done','snoozed')),
      due_at INTEGER,
      snooze_until INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `;
  db.exec(tasksTable);
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_jid_status ON tasks(jid, status)');

  db.prepare('INSERT INTO migrations (name) VALUES (?)').run('015_tasks');
  logger.info('Migration 015_tasks completed');
}

function runGmailMigration(db: ReturnType<typeof getDatabase>): void {
  const applied014 = db.prepare('SELECT name FROM migrations WHERE name = ?').get('014_gmail');
  if (applied014) return;

  logger.info('Running migration: 014_gmail');

  const credentialsTable = `
    CREATE TABLE IF NOT EXISTS gmail_credentials (
      jid TEXT PRIMARY KEY,
      refresh_token_enc TEXT NOT NULL,
      email_address TEXT NOT NULL,
      scopes TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `;
  const labelsTable = `
    CREATE TABLE IF NOT EXISTS gmail_watch_labels (
      jid TEXT NOT NULL,
      label_id TEXT NOT NULL,
      label_name TEXT NOT NULL,
      PRIMARY KEY (jid, label_id)
    )
  `;
  const seenTable = `
    CREATE TABLE IF NOT EXISTS gmail_seen_messages (
      jid TEXT NOT NULL,
      message_id TEXT NOT NULL,
      notified_at INTEGER NOT NULL,
      PRIMARY KEY (jid, message_id)
    )
  `;

  db.exec(credentialsTable);
  db.exec(labelsTable);
  db.exec(seenTable);
  db.exec('CREATE INDEX IF NOT EXISTS idx_gmail_seen_notified ON gmail_seen_messages(notified_at)');

  db.prepare('INSERT INTO migrations (name) VALUES (?)').run('014_gmail');
  logger.info('Migration 014_gmail completed');
}
