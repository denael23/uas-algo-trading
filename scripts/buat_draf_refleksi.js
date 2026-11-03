// Membuat draf refleksi yang angkanya diambil dari laporan. Penjelasan sebab ditulis setelah melihat log.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { rootDir } from '../lib/config.js';
import { readJOpt } from '../lib/files.js';
const root = rootDir(), r = readJOpt(root, 'hasil/laporan.json');
if (!r?.gap) { console.error('Jalankan replay_forward dan hitung_ulang dahulu.'); process.exit(1); }
const n = (v, d = 2) => (v == null ? 'n/a' : Number(v).toFixed(d));
const g = r.gap, o = r.ops, b = r.backtest, f = r.forward, a = g.fill_avg;
const baris = g.fills.map(x => `| ${x.ts} | ${x.pair ?? ''} | ${x.side ?? ''} | ${n(x.forward_fill, 4)} | ${n(x.replay_fill, 4)} | ${n(x.total_pct, 3)} | ${n(x.delay_pct, 3)} | ${n(x.spread_pct, 3)} | ${n(x.slippage_pct, 3)} |`).join('\n');
writeFileSync(path.join(root, 'docs/REFLEKSI.md'), `# Refleksi: backtest vs forward test

Denael, NIM 25120200024. Angka di bawah dibuat oleh scripts/buat_draf_refleksi.js dari hasil/laporan.json.
Bagian bertanda [TULIS] wajib diisi berdasarkan log.

## 1. Ringkasan
| | Backtest | Replay jendela forward | Forward test |
|---|---|---|---|
| Return | ${n(b?.equity.return_pct)}% | ${n(g.replay_return_pct)}% | ${n(g.forward_return_pct)}% |
| Max drawdown | ${n(b?.equity.max_drawdown_pct)}% | ${n(g.replay_mdd_pct)}% | ${n(g.forward_mdd_pct)}% |
| Trade selesai | ${b?.trades.n_trades ?? 'n/a'} | ${g.replay_trades} | ${g.forward_trades} |

Gap return forward dikurangi replay: **${n(g.gap_return_pp)} poin persen**.

## 2. Kecocokan sinyal
${g.signals_match} dari ${g.signals_total} baris sinyal cocok (${n(g.signals_match_pct)}%). Sinyal masuk/keluar: ${g.entry_exit_match} dari ${g.entry_exit_total}.
Hash jendela candle: ${g.window_hash_same} sama, ${g.window_hash_diff} berbeda.
${g.n_mismatches ? `Ada ${g.n_mismatches} ketidakcocokan:\n\n${g.mismatches.map(m => `- ${m.key}: ${m.jenis} (forward ${m.forward}, replay ${m.replay})`).join('\n')}\n\n[TULIS] Penyebab tiap ketidakcocokan.` : 'Tidak ada ketidakcocokan.'}

## 3. Selisih harga fill per order
Rata-rata (persen, positif merugikan forward): total ${n(a.total_pct, 3)}; keterlambatan/pergerakan pasar ${n(a.delay_pct, 3)}; spread ${n(a.spread_pct, 3)}; slippage ${n(a.slippage_pct, 3)}; sisa pembulatan ${n(a.sisa_pct, 3)}.

| Waktu | Pasangan | Sisi | Fill forward | Fill replay | Total % | Keterlambatan % | Spread % | Slippage % |
|---|---|---|---|---|---|---|---|---|
${baris || '| (tidak ada order) | | | | | | | | |'}

[TULIS] Komponen mana yang paling menjelaskan selisih, dan mengapa.

## 4. Biaya
Forward: Rp${n(g.forward_cost_idr, 0)}. Replay: Rp${n(g.replay_cost_idr, 0)}. Porsi biaya forward: ${n(f.trades.cost_share_pct)}% dari laba kotor.
Backtest: ${n(b?.trades.cost_share_pct)}% dari laba kotor.

[TULIS] Apakah spread dan slippage terukur sebelum freeze cukup mewakili kondisi forward test?

## 5. Operasional dan dampak penjadwal
Terjadwal ${o.scheduled}, terlaksana ${o.executed_slots}, uptime ${n(o.uptime_pct)}% (${o.uptime_tier}).
Keterlambatan median ${n(o.median_delay_min, 1)} menit, maksimum ${n(o.max_delay_min, 1)} menit.
Error API: ${o.api_errors}. Kill switch: ${o.kill_switch_on} kali. Daily loss limit: ${o.daily_loss_limit_events} kali.
Perbaikan bug tercatat: ${o.bugfix_events.length}.

[TULIS] Dampak keterlambatan atau slot yang terlewat terhadap fill.

## 6. Kesimpulan
[TULIS] Apa yang dipelajari; apakah backtest dapat dipercaya untuk strategi ini; apa yang akan diubah pada pengujian berikutnya (tanpa mengubah forward test yang sudah berjalan).
`);
console.log('docs/REFLEKSI.md dibuat. Lengkapi bagian [TULIS].');
