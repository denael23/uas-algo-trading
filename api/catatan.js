// Mencatat perbaikan bug yang tidak mengubah aturan selama forward test.
import { createPgDb, createStore } from '../lib/store.js';
import { loadConfig } from '../lib/config.js';
import { modeAt } from '../lib/time.js';
import { needAuth } from '../lib/runtime.js';

export default async function handler(req, res) {
  if (!needAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'pakai POST' });
  let db;
  try {
    db = await createPgDb(process.env.DATABASE_URL);
    const now = Date.now(), body = typeof req.body === 'object' && req.body ? req.body : {};
    const detail = { catatan: String(body.catatan || req.query?.catatan || '').slice(0, 1000), commit: String(body.commit || req.query?.commit || '').slice(0, 64) };
    if (!detail.catatan) return res.status(400).json({ error: 'catatan kosong' });
    await createStore(db).logEvent({ ts: now, mode: modeAt(now, loadConfig().schedule), type: 'perbaikan_bug', detail });
    res.status(200).json({ ok: true });
  } finally { await db?.close().catch(() => {}); }
}
