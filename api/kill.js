// Kill switch tanpa deploy ulang: flag di storage. Menghentikan entry baru; exit tetap berjalan.
import { createPgDb, createStore } from '../lib/store.js';
import { loadConfig } from '../lib/config.js';
import { modeAt } from '../lib/time.js';
import { needAuth } from '../lib/runtime.js';

export default async function handler(req, res) {
  if (!needAuth(req, res)) return;
  let db;
  try {
    db = await createPgDb(process.env.DATABASE_URL);
    const store = createStore(db);
    const state = String(req.query?.state || '').toLowerCase();
    if (req.method === 'GET' && !state) return res.status(200).json(await store.getKv('kill_switch') || { on: false });
    if (req.method !== 'POST' || !['on', 'off'].includes(state)) return res.status(400).json({ error: 'pakai POST ?state=on|off&reason=...' });
    const now = Date.now(), on = state === 'on', reason = String(req.query?.reason || '').slice(0, 300);
    await store.setKv('kill_switch', { on, reason, at: new Date(now).toISOString() }, now);
    await store.logEvent({ ts: now, mode: modeAt(now, loadConfig().schedule), type: on ? 'kill_switch_on' : 'kill_switch_off', detail: { reason } });
    res.status(200).json({ on, reason });
  } finally { await db?.close().catch(() => {}); }
}
