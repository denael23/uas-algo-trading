// Data dashboard Vercel: angka forward dihitung dari log di storage; backtest dan gap dari ringkasan
// yang dihasilkan hitung_ulang. Tidak memuat secret.
import { loadConfig, readOptional } from '../lib/config.js';
import { createPgDb, createStore } from '../lib/store.js';
import { buildAudit, buildForwardSection, buildOps, identity } from '../lib/report.js';

export default async function handler(req, res) {
  let db;
  try {
    db = await createPgDb(process.env.DATABASE_URL);
    const store = createStore(db), cfg = loadConfig(), now = Date.now();
    const pub = readOptional(process.cwd(), 'config/ringkasan_publik.json') || {};
    const dump = (t, w = '', p = []) => store.dumpTable(t, w, p);
    const logs = {
      calls: await dump('calls'), orders: await dump('orders'), equity: await dump('equity'),
      equity_daily: await dump('equity_daily'), errors: await dump('errors'), events: await dump('events'),
      ob_snapshots: (await store.q(`SELECT mode, ts, pair, best_bid, best_ask FROM ob_snapshots WHERE pair='btcidr' ORDER BY id`)).rows.map(r => ({ ...r, ts: new Date(r.ts).toISOString() })),
    };
    const killSwitch = await store.getKv('kill_switch');
    res.setHeader('Cache-Control', 's-maxage=60');
    res.status(200).json({
      identitas: identity(cfg), sumber_biaya: pub.sumber_biaya ?? readOptional(process.cwd(), 'config/biaya_terukur.json'), sumber_tarif: pub.sumber_tarif ?? null,
      freeze: pub.freeze ?? null, manifest: pub.manifest ?? null, data_uji: Boolean(pub.data_uji), audit: buildAudit(logs, cfg),
      backtest: pub.backtest ?? null, gap: pub.gap ?? null,
      forward: buildForwardSection(logs, cfg), ops: buildOps(logs, cfg, now),
      prep: buildOps(logs, cfg, now, 'prep'), kill_switch: killSwitch, dibaca_pada: new Date(now).toISOString(), live: true,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'gagal membaca log' });
  } finally { await db?.close().catch(() => {}); }
}
