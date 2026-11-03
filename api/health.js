// Uji koneksi: dari fungsi Vercel ke Indodax dan ke database, sekaligus membuat skema bila belum ada.
import { createClient } from '../lib/indodax.js';
import { createPgDb, createStore } from '../lib/store.js';
import { needAuth } from '../lib/runtime.js';
import { closedOnly, parseCandles } from '../lib/candles.js';
import { loadConfig } from '../lib/config.js';

export default async function handler(req, res) {
  if (!needAuth(req, res)) return;
  const out = { region: process.env.VERCEL_REGION || null, indodax: {}, db: null };
  const c = createClient({ maxAttempts: 2 });
  const t = async (name, fn) => {
    const s = Date.now();
    try { out.indodax[name] = { ok: true, ms: Date.now() - s, info: await fn(), }; out.indodax[name].ms = Date.now() - s; }
    catch (e) { out.indodax[name] = { ok: false, ms: Date.now() - s, error: String(e.message || e) }; }
  };
  let serverMs = null;
  await t('server_time', async () => (serverMs = await c.serverTimeMs()));
  await t('depth', async () => { const d = await c.depth('btcidr'); return { bids: d.buy?.length, asks: d.sell?.length }; });
  await t('pairs', async () => { const a = await c.pairs(); const b = a.find(x => x.id === 'btcidr'); return { n: a.length, btc_taker_pct: b?.trade_fee_percent_taker ?? null, btc_min_idr: b?.trade_min_base_currency ?? null }; });
  await t('price_increments', async () => (await c.increments())?.btc_idr);
  await t('history_tf240', async () => {
    const now = Math.floor((serverMs ?? Date.now()) / 1000);
    const raw = parseCandles(await c.history('BTCIDR', '240', now - 86400 * 7, now));
    return { bars: raw.length, closed: closedOnly(raw, 240, serverMs ?? Date.now()).length };
  });
  let db;
  try {
    db = await createPgDb(process.env.DATABASE_URL);
    await createStore(db).ensureSchema();
    out.db = { ok: true };
  } catch (e) { out.db = { ok: false, error: String(e.message || e) }; }
  finally { await db?.close().catch(() => {}); }
  try { const u = loadConfig(); out.rules_hash = u.rulesHash; out.universe_status = u.universe.status; out.universe = u.universe.pairs; out.fee_terisi = u.fees.official_taker_buy_pct != null; } catch (e) { out.config_error = String(e.message); }
  const ok = out.db?.ok && Object.values(out.indodax).every(x => x.ok);
  res.status(ok ? 200 : 502).json({ lolos: Boolean(ok), ...out });
}
