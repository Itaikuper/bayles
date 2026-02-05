import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'bayles.db');
let db = null;
export function getDatabase() {
    if (!db) {
        // Ensure data directory exists
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        logger.info(`Database connected: ${DB_PATH}`);
    }
    return db;
}
export function closeDatabase() {
    if (db) {
        db.close();
        db = null;
        logger.info('Database connection closed');
    }
}
