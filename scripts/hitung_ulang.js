// Menghasilkan ulang SEMUA angka dashboard dari log mentah.
//   node scripts/hitung_ulang.js          -> hasil/laporan.json + config/ringkasan_publik.json
//   node scripts/hitung_ulang.js --cek    -> bandingkan dengan angka di dashboard HTML offline
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { rootDir } from '../lib/config.js';
import { assembleReport } from '../lib/assemble.js';
import { writeJ } from '../lib/files.js';

const root = rootDir();
const r = assembleReport(root);
writeJ(root, 'hasil/laporan.json', r);
const { forward, ops, audit, ...pub } = r; // forward dan ops dihitung langsung dari storage oleh dashboard Vercel
writeJ(root, 'config/ringkasan_publik.json', pub);
console.log('hasil/laporan.json ditulis.');
if (r.backtest) console.log('Backtest return %:', r.backtest.equity.return_pct, 'CAGR %:', r.backtest.equity.cagr_pct, 'MDD %:', r.backtest.equity.max_drawdown_pct);
console.log('Forward return %:', forward.equity.return_pct, 'MDD %:', forward.equity.max_drawdown_pct, 'trade:', forward.trades.n_trades);
console.log('Uptime %:', ops.uptime_pct, `(${ops.executed_slots}/${ops.scheduled})`);
if (r.gap) console.log('Kecocokan sinyal %:', r.gap.signals_match_pct, `(${r.gap.signals_match}/${r.gap.signals_total})`);
if (process.argv.includes('--cek')) {
  const file = readdirSync(root).find(f => /^UAS_.*\.html$/.test(f));
  if (!file) { console.error('Dashboard offline belum dibuat.'); process.exit(1); }
  const html = readFileSync(path.join(root, file), 'utf8');
  const m = html.match(/<script id="laporan" type="application\/json">([\s\S]*?)<\/script>/);
  const embedded = JSON.parse(m[1].replace(/\\u003c/g, '<'));
  const same = JSON.stringify(embedded) === JSON.stringify(JSON.parse(JSON.stringify(r)));
  console.log(same ? `COCOK: angka ${file} identik dengan hasil hitung ulang.` : `TIDAK COCOK: ${file} berbeda dari hasil hitung ulang.`);
  process.exit(same ? 0 : 1);
}
