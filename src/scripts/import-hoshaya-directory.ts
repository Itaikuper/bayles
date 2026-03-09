import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from '../database/migrate.js';
import { getHoshayaDirectoryRepository } from '../database/repositories/hoshaya-directory.repository.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.resolve(__dirname, '../../data/hoshaya-directory.json');

interface RawEntry {
  name: string;
  home_phone: string;
  mobile_phone: string;
  address: string;
}

function splitName(fullName: string): { first_name: string; last_name: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { first_name: parts[0], last_name: '' };
  }
  // In Hebrew convention on this site: last_name first_name (family name first)
  const last_name = parts[0];
  const first_name = parts.slice(1).join(' ');
  return { first_name, last_name };
}

async function main() {
  console.log('Running migrations...');
  runMigrations();

  console.log(`Reading data from ${dataPath}...`);
  const raw: RawEntry[] = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  console.log(`Found ${raw.length} entries`);

  const entries = raw.map(e => {
    const { first_name, last_name } = splitName(e.name);
    return {
      first_name,
      last_name,
      home_phone: e.home_phone || '',
      mobile_phone: e.mobile_phone || '',
      address: e.address || '',
    };
  });

  const repo = getHoshayaDirectoryRepository();

  // Clear existing data and re-import
  console.log('Clearing existing directory data...');
  repo.clear();

  console.log(`Importing ${entries.length} entries...`);
  const count = repo.bulkInsert(entries);
  console.log(`Successfully imported ${count} entries`);

  // Verify
  const total = repo.count();
  console.log(`Total entries in DB: ${total}`);

  // Test search
  const testResults = repo.search('כהן');
  console.log(`Test search for "כהן": ${testResults.length} results`);
  if (testResults.length > 0) {
    console.log(`  First: ${testResults[0].first_name} ${testResults[0].last_name} - ${testResults[0].mobile_phone || testResults[0].home_phone}`);
  }
}

main().catch(console.error);
