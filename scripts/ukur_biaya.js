// Median spread dan slippage per pasangan dari snapshot order book mentah sebelum freeze.
import { loadConfig, rootDir } from '../lib/config.js';
import { measureCosts } from '../lib/metrics.js';
import { readJ, writeJ } from '../lib/files.js';
const root = rootDir(), cfg = loadConfig(root);
const cutoff = Date.parse(cfg.schedule.forward_start_iso);
const snaps = readJ(root, 'log_mentah/ob_snapshots.json').filter(s => Date.parse(s.ts) < cutoff);
if (!snaps.length) { console.error('Belum ada snapshot. Jalankan ekspor_log setelah bot berjalan.'); process.exit(1); }
const order = cfg.strategy.estimasi_ukuran_order_idr;
const m = measureCosts(snaps, order);
const out = { sumber: 'log_mentah/ob_snapshots.json', ukuran_order_idr: order, snapshot_pertama: snaps[0].ts, snapshot_terakhir: snaps.at(-1).ts, pasangan: m };
for (const pair of new Set([...cfg.universe.pairs, 'btcidr'])) {
  const x = m[pair];
  if (!x) { console.error(`TIDAK ADA snapshot untuk ${pair}`); process.exit(1); }
  if (x.slippagePct === null) { console.error(`Kedalaman tersimpan tidak cukup untuk ${pair} pada ukuran Rp${order}. Naikkan book_levels_saved sebelum freeze atau kurangi ukuran.`); process.exit(1); }
  const perDay = x.n_snapshot / Math.max(x.n_hari, 1);
  if (perDay < 3) console.warn(`PERINGATAN: ${pair} hanya ${perDay.toFixed(1)} snapshot/hari (minimum 3).`);
  console.log(pair, `spread=${x.spreadPct.toFixed(4)}% slippage=${x.slippagePct.toFixed(4)}% n=${x.n_snapshot}`);
}
writeJ(root, 'config/biaya_terukur.json', out);
