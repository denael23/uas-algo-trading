// Backtest >= 3 tahun dengan data asli, fee taker yang lebih mahal, spread dan slippage terukur.
import { effectiveFee, loadConfig, rootDir } from '../lib/config.js';
import { readJ, readJOpt, writeJ } from '../lib/files.js';
import { runBacktest } from '../lib/backtest.js';
import { buildBacktestSection } from '../lib/report.js';

const root = rootDir(), cfg = loadConfig(root), p = cfg.strategy;
const dataUji = process.argv.includes('--data-uji');
const stop = m => { console.error('BERHENTI: ' + m); process.exit(1); };
if (cfg.universe.status !== 'final') stop('universe belum final. Jalankan pilih_universe.');
const manifest = readJOpt(root, 'data/candles/manifest.json');
if (!manifest) stop('data belum ditarik. Jalankan tarik_data.');
if (manifest.sumber !== 'indodax_public_api' && !dataUji) stop('data bukan dari API Indodax.');
const biaya = readJOpt(root, 'config/biaya_terukur.json'); if (!biaya) stop('biaya terukur belum ada. Jalankan ukur_biaya.');
const tarif = readJOpt(root, 'hasil/sumber_tarif.json'); if (!tarif) stop('jalankan cek_sumber.');
const apiMax = Math.max(...cfg.universe.pairs.map(x => tarif.pasangan[x]?.takerPct ?? 0));
const fee = effectiveFee(cfg.fees, apiMax); if (!fee) stop('isi tarif resmi di config/fees.json.');
const startSec = Math.floor(Date.parse(cfg.schedule.backtest_start_iso) / 1000);
const endSec = Math.floor(Date.parse(cfg.schedule.backtest_end_iso) / 1000);
const candlesByPair = {}, costs = {}, meta = {};
for (const x of cfg.universe.pairs) { if (!tarif.pasangan[x]) stop(`jalankan ulang cek_sumber: ${x} belum ada di sumber_tarif.`); if (!biaya.pasangan[x]) stop(`tidak ada snapshot untuk ${x}.`); candlesByPair[x] = readJ(root, `data/candles/${x}_${p.tf_param}.json`); costs[x] = biaya.pasangan[x]; meta[x] = tarif.pasangan[x]; }
const firstBars = cfg.universe.pairs.map(x => candlesByPair[x][0]?.t);
const r = runBacktest({ candlesByPair, universe: cfg.universe.pairs, p, fee, costs, meta, startSec, endSec });
const data_sha = Object.fromEntries(Object.entries(manifest.pasangan).map(([k, v]) => [k, v.sha256]));
const m = { start_sec: startSec, end_sec: Math.min(endSec, (r.equity.length ? Math.floor(Date.parse(r.equity.at(-1).ts) / 1000) : endSec)), universe: cfg.universe.pairs, fee, costs: { ...costs, btcidr: biaya.pasangan.btcidr }, benchmark_cost: biaya.pasangan.btcidr, block_counts: r.blockCounts, open_positions: r.openPositions, data_sha, data_uji: dataUji || undefined, rules_hash: cfg.rulesHash, bar_pertama: firstBars };
const years = (m.end_sec - startSec) / (365.25 * 86400);
if (years < 3) stop(`cakupan backtest ${years.toFixed(3)} tahun, minimum 3. Tidak ada file yang ditulis.`);
writeJ(root, 'log_backtest/backtest_orders.json', r.orders);
writeJ(root, 'log_backtest/backtest_equity.json', r.equity);
writeJ(root, 'log_backtest/backtest_equity_daily.json', r.equityDaily);
writeJ(root, 'log_backtest/backtest_signals.json', r.signals);
writeJ(root, 'log_backtest/backtest_meta.json', m);
const sec = buildBacktestSection({ meta: m, orders: r.orders, equity: r.equity, equityDaily: r.equityDaily }, readJ(root, `data/candles/btcidr_${p.tf_param}.json`), cfg);
console.log(JSON.stringify({ equity: sec.equity, trades: sec.trades, benchmark: sec.benchmark, blokir: r.blockCounts }, null, 1));
