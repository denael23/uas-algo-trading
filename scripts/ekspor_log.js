// Mengekspor semua log dari storage ke log_mentah/ (JSON) dan versi CSV.
import { loadEnv } from '../lib/env.js';
import { createPgDb, createStore, LOG_TABLES } from '../lib/store.js';
import { rootDir } from '../lib/config.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { toCsv, writeJ } from '../lib/files.js';
const root = rootDir(); loadEnv(root);
const db = await createPgDb(process.env.DATABASE_URL);
const store = createStore(db);
mkdirSync(path.join(root, 'log_mentah/csv'), { recursive: true });
for (const t of LOG_TABLES) {
  const rows = await store.dumpTable(t);
  writeJ(root, `log_mentah/${t}.json`, rows);
  writeFileSync(path.join(root, `log_mentah/csv/${t}.csv`), toCsv(rows));
  console.log(t, rows.length);
}
await db.close();
