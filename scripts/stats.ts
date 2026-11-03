import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../server/config.js';
import { collectStats, formatStats } from '../server/stats.js';

// Prints counts from the database. No message text is read, and the file is opened read only.
const { dbPath } = loadConfig({ ...process.env, REWRITER: 'fake' });
if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath} yet. Start the service once, or set DB_PATH.`);
  process.exit(1);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
console.log(formatStats(collectStats(db)));
