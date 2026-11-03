import { loadEnv } from '../lib/env.js';
import { createPgDb, createStore } from '../lib/store.js';
loadEnv();
const db = await createPgDb(process.env.DATABASE_URL);
await createStore(db).ensureSchema();
await db.close();
console.log('Skema siap.');
