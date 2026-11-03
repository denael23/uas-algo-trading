// Menjalankan ulang backtest pada jendela forward test dengan candle yang sama, memakai fungsi sinyal yang sama.
import { effectiveFee, loadConfig, rootDir } from '../lib/config.js';
import { readJ, readJOpt, readLogs, writeJ } from '../lib/files.js';
import { runBacktest } from '../lib/backtest.js';
import { externalBlocksFromLogs } from '../lib/report.js';

const root = rootDir(), cfg = loadConfig(root), p = cfg.strategy;
const manifest = readJOpt(root, 'data/candles_replay/manifest.json');
if (!manifest) { console.error('Jalankan: node scripts/tarik_data.js --replay'); process.exit(1); }
const dataUji = process.argv.includes('--data-uji');
if (manifest.sumber !== 'indodax_public_api' && !dataUji) { console.error('Data replay bukan dari API Indodax.'); process.exit(1); }
const biaya = readJ(root, 'config/biaya_terukur.json'), tarif = readJ(root, 'hasil/sumber_tarif.json');
const fee = effectiveFee(cfg.fees, Math.max(...cfg.universe.pairs.map(x => tarif.pasangan[x]?.takerPct ?? 0)));
const logs = readLogs(root);
const candlesByPair = {}, costs = {}, meta = {};
for (const x of cfg.universe.pairs) { candlesByPair[x] = readJ(root, `data/candles_replay/${x}_${p.tf_param}.json`); costs[x] = biaya.pasangan[x]; meta[x] = tarif.pasangan[x]; }
const startSec = Math.floor(Date.parse(cfg.schedule.forward_start_iso) / 1000), endSec = Math.floor(Date.parse(cfg.schedule.forward_end_iso) / 1000);
const externalBlocks = externalBlocksFromLogs(logs.signals);
const r = runBacktest({ candlesByPair, universe: cfg.universe.pairs, p, fee, costs, meta, startSec, endSec, mode: 'replay', externalBlocks, collectSignals: true, withHash: true });
writeJ(root, 'log_backtest/replay_orders.json', r.orders);
writeJ(root, 'log_backtest/replay_equity.json', r.equity);
writeJ(root, 'log_backtest/replay_signals.json', r.signals);
writeJ(root, 'log_backtest/replay_meta.json', { data_uji: dataUji || undefined, start_sec: startSec, end_sec: endSec, fee, blok_dari_log_forward: externalBlocks, data_sha: Object.fromEntries(Object.entries(manifest.pasangan).map(([k, v]) => [k, v.sha256])) });
console.log(`Replay selesai: ${r.signals.length} baris sinyal, ${r.orders.length} order.`);
