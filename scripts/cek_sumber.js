// Mencatat tarif, minimum order, dan kenaikan harga dari API publik beserta URL dan tanggal akses.
import { createClient } from '../lib/indodax.js';
import { loadConfig, pairMeta, rootDir } from '../lib/config.js';
import { writeJ } from '../lib/files.js';
const root = rootDir(), cfg = loadConfig(root);
const c = createClient({ minGapMs: 400, onError: e => console.error('API:', e.scope, e.message) });
const [serverMs, pairs, inc] = [await c.serverTimeMs(), await c.pairs(), await c.increments()];
const meta = pairMeta(pairs, inc);
const idr = pairs.filter(x => x.base_currency === 'idr');
const hist = {};
for (const x of idr) { const k = String(x.trade_fee_percent_taker); hist[k] = (hist[k] || 0) + 1; }
const out = {
  diakses_pada: new Date(serverMs).toISOString(),
  url: { pairs: 'https://indodax.com/api/pairs', price_increments: 'https://indodax.com/api/price_increments', server_time: 'https://indodax.com/api/server_time' },
  jumlah_pasangan_idr: idr.length, sebaran_taker_pct_idr: hist,
  pasangan: Object.fromEntries([...new Set([...cfg.universe.pairs, 'btcidr'])].map(p => [p, meta[p] ?? null])),
  resmi: cfg.fees,
};
writeJ(root, 'hasil/sumber_tarif.json', out);
console.log(JSON.stringify(out, null, 1));
if (cfg.fees.official_taker_buy_pct == null) console.log('\nPERHATIAN: isi config/fees.json dari halaman resmi sebelum menjalankan backtest dan bot.');
