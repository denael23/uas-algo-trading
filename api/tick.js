import { loadConfig } from '../lib/config.js';
import { createClient } from '../lib/indodax.js';
import { createPgDb, createStore } from '../lib/store.js';
import { runTick } from '../lib/tick.js';
import { needAuth } from '../lib/runtime.js';

export default async function handler(req, res) {
  if (!needAuth(req, res)) return;
  let db;
  try {
    db = await createPgDb(process.env.DATABASE_URL);
    const store = createStore(db);
    const ua = String(req.headers?.['user-agent'] || '');
    const source = String(req.query?.source || (ua.startsWith('vercel-cron') ? 'vercel_cron' : 'external')).slice(0, 40);
    const out = await runTick({ store, cfg: loadConfig(), createClient, source, gitSha: process.env.VERCEL_GIT_COMMIT_SHA || null });
    res.status(out.status === 'error' ? 500 : 200).json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 'error', message: 'lihat log server' });
  } finally { await db?.close().catch(() => {}); }
}
