// Dijalankan sebelum freeze date (config/schedule.json). Commit file ini adalah bukti freeze.
import { loadConfig, rootDir } from '../lib/config.js';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { readJOpt, sha256File, writeJ } from '../lib/files.js';
const root = rootDir(), cfg = loadConfig(root);
const problems = [];
if (cfg.universe.status !== 'final') problems.push('universe belum final');
if (cfg.fees.official_taker_buy_pct == null) problems.push('tarif resmi belum diisi');
if (!readJOpt(root, 'config/biaya_terukur.json')) problems.push('biaya terukur belum ada');
const btm = readJOpt(root, 'log_backtest/backtest_meta.json');
if (!btm) problems.push('backtest belum dijalankan');
if (btm?.data_uji) problems.push('backtest memakai data uji sintetis');
if (problems.length) { console.error('BELUM SIAP FREEZE: ' + problems.join('; ')); process.exit(1); }
const files = ['config/strategy.json', 'config/universe.json', 'config/fees.json', 'config/schedule.json', 'config/biaya_terukur.json', 'lib/signal.js', 'lib/indicators.js', 'lib/candles.js'];
writeJ(root, 'FREEZE.json', { dicatat_pada: new Date().toISOString(), freeze_date: cfg.schedule.forward_start_iso, waktu_mulai_forward: cfg.schedule.forward_start_iso, waktu_selesai_forward: cfg.schedule.forward_end_iso, rules_hash: cfg.rulesHash, universe: cfg.universe.pairs, parameter: cfg.strategy, sha256_file: Object.fromEntries(files.map(f => [f, sha256File(root, f)])) });
appendFileSync(path.join(root, 'README.md'), `\n## Catatan freeze\n\n- Dicatat: ${new Date().toISOString()}\n- Waktu mulai forward test: ${cfg.schedule.forward_start_iso}\n- Waktu selesai: ${cfg.schedule.forward_end_iso}\n- Universe: ${cfg.universe.pairs.join(', ')}\n- Hash aturan: ${cfg.rulesHash}\n- Parameter lengkap: config/strategy.json dan FREEZE.json\n`);
console.log('FREEZE.json dibuat dan README diperbarui. Lanjutkan:\n  git add -A\n  git commit -m "FREEZE aturan, parameter, universe"\n  git tag freeze\n  git push\n  git push origin freeze\nJangan pernah memakai force-push setelah ini.');
