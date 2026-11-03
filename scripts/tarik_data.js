// Menarik candle historis ASLI Indodax secara berurutan (maksimal 3 request/detik). Dijalankan di laptop.
// node scripts/tarik_data.js              -> data/candles (untuk backtest)
// node scripts/tarik_data.js --replay     -> data/candles_replay (setelah forward test selesai)
import { createClient } from '../lib/indodax.js';
import { closedOnly, parseCandles } from '../lib/candles.js';
import { loadConfig, rootDir } from '../lib/config.js';
import { sha256File, writeJ } from '../lib/files.js';

const root = rootDir(), cfg = loadConfig(root), p = cfg.strategy;
const replay = process.argv.includes('--replay');
const dir = replay ? 'data/candles_replay' : 'data/candles';
const c = createClient({ minGapMs: 400, onError: e => console.error('API:', e.scope, e.pair ?? '', e.message) });
const dur = p.timeframe_minutes * 60, STEP = 500 * dur;
const serverMs = await c.serverTimeMs(), now = Math.floor(serverMs / 1000);
const startIso = replay ? cfg.schedule.forward_start_iso : cfg.schedule.backtest_start_iso;
const from0 = Math.floor(Date.parse(startIso) / 1000) - (p.window_bars + 12) * dur;
const manifest = { sumber: 'indodax_public_api', endpoint: 'https://indodax.com/tradingview/history_v2', tf: p.tf_param, ditarik_pada: new Date(serverMs).toISOString(), dari: new Date(from0 * 1000).toISOString(), pasangan: {} };
const metaP = Object.fromEntries((await c.pairs()).map(x => [x.id, x.symbol]));
for (const pair of [...new Set([...cfg.universe.pairs, 'btcidr'])]) {
  const symbol = metaP[pair] || pair.toUpperCase();
  const map = new Map(); let req = 0;
  for (let a = from0; a < now; a += STEP) {
    const raw = await c.history(symbol, p.tf_param, a, Math.min(a + STEP - 1, now)); req++;
    for (const b of parseCandles(raw)) map.set(b.t, b);
  }
  const bars = closedOnly([...map.values()].sort((x, y) => x.t - y.t), p.timeframe_minutes, serverMs);
  let gaps = 0, zeroVol = 0;
  bars.forEach((b, i) => { if (i && b.t - bars[i - 1].t !== dur) gaps++; if (!(b.v > 0)) zeroVol++; });
  const f = `${dir}/${pair}_${p.tf_param}.json`;
  writeJ(root, f, bars);
  manifest.pasangan[pair] = { symbol, bar: bars.length, request: req, bar_pertama: bars[0] && new Date(bars[0].t * 1000).toISOString(), bar_terakhir: bars.at(-1) && new Date(bars.at(-1).t * 1000).toISOString(), celah: gaps, bar_volume_nol: zeroVol, sha256: sha256File(root, f) };
  console.log(pair, manifest.pasangan[pair]);
}
writeJ(root, `${dir}/manifest.json`, manifest);
