// Uji ujung ke ujung: bot tiap jam selama jendela forward tersimulasi di Postgres sungguhan (PGlite), lawan tiruan API.
// Data sintetis, hanya menguji perangkat lunak. Output ditulis ke folder sementara.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = fileURLToPath(new URL('..', import.meta.url));
import { createClient } from '../lib/indodax.js';
import { runTick } from '../lib/tick.js';
import { LOG_TABLES } from '../lib/store.js';
import { writeJ } from '../lib/files.js';
import { rulesHash } from '../lib/config.js';
import { fakeExchange, memStore, syntheticCandles, testConfig } from './helpers.js';
import { measureCosts } from '../lib/metrics.js';

const dur = 14400;
const JADWAL = testConfig().schedule;
const fwStart = Date.parse(JADWAL.forward_start_iso), fwEnd = Date.parse(JADWAL.forward_end_iso);
const SLOTS = (fwEnd - fwStart) / 3600000;
const grid = Math.floor(fwStart / 1000 / dur) * dur;
function candleSet() {
  const n = 400 + 110; // 400 bar sebelum start + seluruh jendela
  const startSec = grid - 400 * dur;
  return {
    btcidr: syntheticCandles({ startSec, n, seed: 11, price: 1700000000, inc: 1000, phase: 388 }),
    ethidr: syntheticCandles({ startSec, n, seed: 23, price: 60000000, inc: 1000, phase: 388 }),
    solidr: syntheticCandles({ startSec, n, seed: 37, price: 3000000, phase: 388 }),
  };
}
const clientFactory = (fetchImpl) => ({ onError }) => createClient({ fetchImpl, onError, minGapMs: 0, maxAttempts: 2, sleep: async () => {} });

test('idempotency: panggilan ganda untuk slot/candle sama tidak membeli lagi', async () => {
  const { store } = await memStore();
  const candles = candleSet(); let now = fwStart + 3 * 60000;
  const cfg = testConfig();
  const fetchImpl = fakeExchange({ candles, now: () => now });
  const a = await runTick({ store, cfg, createClient: clientFactory(fetchImpl), nowMs: () => now, source: 't' });
  assert.ok(['ok', 'ok_with_errors'].includes(a.status));
  const b = await runTick({ store, cfg, createClient: clientFactory(fetchImpl), nowMs: () => now + 1000, source: 't' });
  assert.equal(b.status, 'duplicate_slot');
  // Lapis kedua: slot berbeda tetapi candle sama. Tidak ada sinyal baru.
  now += 3600000;
  const before = (await store.dumpTable('orders')).length;
  const c = await runTick({ store, cfg, createClient: clientFactory(fetchImpl), nowMs: () => now, source: 't' });
  const candleT = Math.floor(now / 1000 / dur) * dur;
  const rows = (await store.dumpTable('signals')).filter(s => s.mode === 'forward');
  assert.equal(new Set(rows.map(s => s.pair + s.candle_time)).size, rows.length);
  assert.ok(rows.every(s => s.candle_time + dur <= now / 1000), 'tidak ada candle berjalan yang diproses');
  assert.ok(candleT > 0); assert.ok(c.status.startsWith('ok')); assert.ok((await store.dumpTable('orders')).length >= before);
});
test('lease: dua panggilan serentak, yang kedua dilewati', async () => {
  const { store } = await memStore();
  const now = fwStart + 60000, cfg = testConfig();
  await store.acquireLease('lain', now, 60000);
  const r = await runTick({ store, cfg, createClient: clientFactory(fakeExchange({ candles: candleSet(), now: () => now })), nowMs: () => now, source: 't' });
  assert.equal(r.status, 'skipped_locked');
});
test('endpoint gagal: error dicatat, retry terbatas, tick tidak jatuh, tidak ada order', async () => {
  const { store } = await memStore();
  const now = fwStart + 60000, cfg = testConfig();
  const r = await runTick({ store, cfg, createClient: clientFactory(fakeExchange({ candles: candleSet(), now: () => now, failAll: () => true })), nowMs: () => now, source: 't' });
  assert.equal(r.status, 'ok_with_errors');
  assert.equal((await store.dumpTable('orders')).length, 0);
  assert.ok((await store.dumpTable('errors')).length >= 2);
});
test('tarif belum diisi: bot tidak bertransaksi dan mencatat alasannya', async () => {
  const { store } = await memStore();
  const candles = candleSet(); let now = fwStart + 60000;
  const cfg = testConfig(); cfg.fees.official_taker_buy_pct = null; cfg.fees.official_taker_sell_pct = null;
  const f = fakeExchange({ candles, now: () => now });
  while (now < fwEnd) { await runTick({ store, cfg, createClient: clientFactory(f), nowMs: () => now, source: 't' }); now += 3600000; }
  assert.equal((await store.dumpTable('orders')).length, 0);
  assert.ok((await store.dumpTable('errors')).some(e => e.message === 'fee_resmi_belum_diisi'));
  const blocked = (await store.dumpTable('signals')).filter(s => s.raw_action === 'BUY');
  assert.ok(blocked.length > 0, 'data uji harus menghasilkan sinyal');
  assert.ok(blocked.every(s => s.final_action === 'BLOCKED'));
});

async function runForward({ kill = null, dropSlots = new Set(), dll = null, emptyAt = null }) {
  const { store } = await memStore();
  const candles = candleSet(), cfg = testConfig();
  if (dll !== null) { cfg.strategy.daily_loss_limit_pct = dll; cfg.rulesHash = rulesHash(cfg); }
  let now = fwStart - 6 * 3600000 + 3 * 60000; let i = 0;
  const f = fakeExchange({ candles, now: () => now, emptyBook: p => emptyAt !== null && now >= emptyAt && now < emptyAt + 2 * 3600000 });
  // Persiapan 6 jam + forward test, tiap jam menit ke-3
  while (now < fwEnd) {
    if (kill && now >= kill.on && !(await store.getKv('kill_switch'))) {
      await store.setKv('kill_switch', { on: true }, now);
      await store.logEvent({ ts: now, mode: 'forward', type: 'kill_switch_on', detail: { reason: 'uji' } });
    }
    if (kill && now >= kill.off && (await store.getKv('kill_switch'))?.on) {
      await store.setKv('kill_switch', { on: false }, now);
      await store.logEvent({ ts: now, mode: 'forward', type: 'kill_switch_off', detail: {} });
    }
    if (!dropSlots.has(i)) {
      const r = await runTick({ store, cfg, createClient: clientFactory(f), nowMs: () => now, source: i % 2 ? 'a' : 'b', gitSha: 'abc' });
      assert.notEqual(r.status, 'error', JSON.stringify(r));
    }
    now += 3600000; i++;
  }
  return { store, candles, cfg };
}
async function exportTo(root, store) {
  for (const t of LOG_TABLES) writeJ(root, `log_mentah/${t}.json`, await store.dumpTable(t));
}
function project(cfg, candles) {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'uas-uji-')), 'proyek'); mkdirSync(root);
  const here = HERE;
  cpSync(path.join(here, 'config'), path.join(root, 'config'), { recursive: true });
  mkdirSync(path.join(root, 'docs'));
  cpSync(path.join(here, 'lib'), path.join(root, 'lib'), { recursive: true });
  writeJ(root, 'config/strategy.json', cfg.strategy);
  writeJ(root, 'config/universe.json', cfg.universe);
  writeJ(root, 'config/fees.json', cfg.fees);
  for (const d of ['candles', 'candles_replay']) {
    for (const [p, b] of Object.entries(candles)) writeJ(root, `data/${d}/${p}_240.json`, b.filter(x => (x.t + dur) * 1000 <= fwEnd + 3600000));
    writeJ(root, `data/${d}/manifest.json`, { sumber: 'DATA_UJI_SINTETIS', pasangan: {} });
  }
  writeJ(root, 'hasil/sumber_tarif.json', { diakses_pada: new Date(fwStart).toISOString(), pasangan: Object.fromEntries(Object.keys(candles).map(p => [p, { qtyInc: 1e-8, minBaseIdr: 10000, minQty: 0.00001, takerPct: 0.2 }])) });
  return root;
}
const run = (root, script, ...args) => execFileSync('node', [path.join(HERE, 'scripts', script), ...args], { env: { ...process.env, UAS_ROOT: root }, encoding: 'utf8', cwd: root });

test('alur lengkap: forward -> replay -> hitung_ulang -> dashboard; sinyal cocok 100%', { timeout: 280000 }, async () => {
  const { store, candles, cfg } = await runForward({});
  const root = project(cfg, candles);
  await exportTo(root, store);
  const orders = await store.dumpTable('orders');
  assert.ok(orders.filter(o => o.mode === 'forward').length >= 2, 'data uji harus menghasilkan order');
  for (const o of orders) {
    if (o.side === 'BUY') assert.ok(o.avg_fill >= o.best_ask); else assert.ok(o.avg_fill <= o.best_bid);
    assert.notEqual(o.avg_fill, (o.best_bid + o.best_ask) / 2);
    assert.ok(o.notional_idr >= 25000);
  }
  const snaps = (await store.dumpTable('ob_snapshots')).filter(s => s.mode === 'prep');
  writeJ(root, 'config/biaya_terukur.json', { sumber: 'uji', ukuran_order_idr: 2e7, snapshot_pertama: snaps[0].ts, snapshot_terakhir: snaps.at(-1).ts, pasangan: measureCosts(snaps, 2e7) });
  run(root, 'replay_forward.js', '--data-uji');
  const out = run(root, 'hitung_ulang.js');
  const lap = JSON.parse(readFileSync(path.join(root, 'hasil/laporan.json'), 'utf8'));
  assert.equal(lap.gap.signals_match_pct, 100, JSON.stringify(lap.gap.mismatches.slice(0, 5)));
  assert.equal(lap.gap.entry_exit_match, lap.gap.entry_exit_total);
  assert.equal(lap.gap.window_hash_diff, 0);
  assert.equal(lap.gap.forward_orders, lap.gap.replay_orders);
  assert.ok(lap.gap.signals_total >= 3 * (SLOTS / 4 - 2));
  assert.deepEqual(lap.ops.rules_hashes, [lap.identitas.rules_hash], 'hash aturan log = hash aturan laporan');
  assert.equal(lap.ops.scheduled, SLOTS); assert.equal(lap.ops.executed_slots, SLOTS); assert.equal(lap.ops.uptime_pct, 100);
  assert.ok(lap.forward.equity_daily.length >= SLOTS / 24);
  assert.ok(lap.forward.benchmark);
  for (const x of lap.gap.fills) assert.ok(Math.abs(x.sisa_pct) < 0.02, 'dekomposisi harus menutup selisih: ' + x.sisa_pct);
  // Angka return dihitung ulang dengan tangan dari log
  const eq = JSON.parse(readFileSync(path.join(root, 'log_mentah/equity.json'), 'utf8')).filter(x => x.mode === 'forward');
  assert.ok(Math.abs(lap.forward.equity.return_pct - (eq.at(-1).equity / 1e8 - 1) * 100) < 1e-9);
  // Akuntansi: kas akhir = modal + semua arus kas order
  const fo = orders.filter(o => o.mode === 'forward');
  const cash = fo.reduce((c, o) => c + (o.side === 'BUY' ? -(o.notional_idr + o.fee_idr) : o.notional_idr - o.fee_idr), 1e8);
  assert.ok(Math.abs(cash - eq.at(-1).cash) < 1e-3);
  run(root, 'bangun_dashboard.js');
  const cek = run(root, 'hitung_ulang.js', '--cek');
  assert.match(cek, /COCOK/);
  // Dashboard offline: tidak ada sumber eksternal
  const html = readFileSync(path.join(root, 'UAS_25120200024_Denael.html'), 'utf8');
  assert.ok(!/src="http|href="http|@import/.test(html));
  run(root, 'buat_draf_refleksi.js');
  assert.match(readFileSync(path.join(root, 'docs/REFLEKSI.md'), 'utf8'), /Kecocokan sinyal/);
});
test('kill switch tercatat dan memblok entry; sinyal mentah tetap cocok dengan replay', { timeout: 200000 }, async () => {
  const { store, candles, cfg } = await runForward({ kill: { on: fwStart, off: fwStart + 7 * 86400000 } });
  const root = project(cfg, candles);
  await exportTo(root, store);
  const sig = (await store.dumpTable('signals')).filter(s => s.mode === 'forward');
  const killed = sig.filter(s => s.block_reason === 'kill_switch');
  assert.ok(killed.length > 0, 'kill switch harus memblok minimal satu entry pada data uji');
  writeJ(root, 'config/biaya_terukur.json', { sumber: 'uji', ukuran_order_idr: 2e7, pasangan: measureCosts((await store.dumpTable('ob_snapshots')).filter(s => s.mode === 'prep'), 2e7) });
  run(root, 'replay_forward.js', '--data-uji'); run(root, 'hitung_ulang.js');
  const lap = JSON.parse(readFileSync(path.join(root, 'hasil/laporan.json'), 'utf8'));
  assert.equal(lap.ops.kill_switch_on, 1); assert.equal(lap.ops.kill_switch_off, 1);
  assert.equal(lap.gap.signals_match_pct, 100, JSON.stringify(lap.gap.mismatches.slice(0, 5)));
});
test('daily loss limit: tercatat sekali per hari WIB dan memblok semua entry', { timeout: 200000 }, async () => {
  // Batas 0% berarti terpicu begitu equity tidak naik dari awal hari, sehingga cabang ini pasti teruji.
  const { store } = await runForward({ dll: 0 });
  const ev = (await store.dumpTable('events')).filter(e => e.type === 'daily_loss_limit' && e.mode === 'forward');
  const sig = (await store.dumpTable('signals')).filter(s => s.mode === 'forward' && s.raw_action === 'BUY');
  assert.ok(ev.length >= SLOTS / 24);
  const wibs = ev.map(e => (typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail).wib);
  assert.equal(new Set(wibs).size, wibs.length, 'sekali per hari WIB');
  assert.ok(sig.length > 0);
  assert.ok(sig.every(s => s.block_reason === 'daily_loss_limit'));
  assert.equal((await store.dumpTable('orders')).filter(o => o.mode === 'forward').length, 0);
});
test('daily loss limit realistis: setelah terpicu tidak ada beli sampai hari WIB berikutnya', { timeout: 200000 }, async () => {
  const { store } = await runForward({ dll: 0.05 });
  const ev = (await store.dumpTable('events')).filter(e => e.type === 'daily_loss_limit' && e.mode === 'forward');
  assert.ok(ev.length > 0);
  const buys = (await store.dumpTable('orders')).filter(o => o.mode === 'forward' && o.side === 'BUY');
  for (const e of ev) {
    const wib = (typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail).wib;
    const later = buys.filter(o => o.ts > e.ts && new Date(Date.parse(o.ts) + 7 * 3600000).toISOString().slice(0, 10) === wib);
    assert.equal(later.length, 0);
  }
});
test('slot terlewat: uptime turun dan candle tetap diproses saat tick berikutnya', { timeout: 200000 }, async () => {
  const drop = new Set([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]); // 12 jam: mencakup >2 candle
  const { store, candles, cfg } = await runForward({ dropSlots: drop });
  const root = project(cfg, candles);
  await exportTo(root, store);
  writeJ(root, 'config/biaya_terukur.json', { sumber: 'uji', ukuran_order_idr: 2e7, pasangan: measureCosts((await store.dumpTable('ob_snapshots')).filter(s => s.mode === 'prep'), 2e7) });
  run(root, 'replay_forward.js', '--data-uji'); run(root, 'hitung_ulang.js');
  const lap = JSON.parse(readFileSync(path.join(root, 'hasil/laporan.json'), 'utf8'));
  assert.equal(lap.ops.executed_slots, SLOTS - 12);
  assert.ok(lap.ops.uptime_pct < 100);
  assert.equal(lap.gap.signals_match_pct, 100, JSON.stringify(lap.gap.mismatches.slice(0, 5)));
});
test('order book kosong: exit menjadi tertunda lalu tereksekusi; entry diblok', { timeout: 200000 }, async () => {
  const base = await runForward({});
  const firstSell = (await base.store.dumpTable('orders')).find(o => o.mode === 'forward' && o.side === 'SELL');
  assert.ok(firstSell, 'data uji harus punya order jual');
  const slot = Math.floor(Date.parse(firstSell.ts) / 3600000) * 3600000;
  const { store } = await runForward({ emptyAt: slot });
  const sig = (await store.dumpTable('signals')).find(s => s.pair === firstSell.pair && s.candle_time === firstSell.signal_candle && s.mode === 'forward');
  assert.equal(sig.final_action, 'SELL_PENDING');
  const sold = (await store.dumpTable('orders')).find(o => o.pair === firstSell.pair && o.side === 'SELL' && o.signal_candle === firstSell.signal_candle);
  assert.ok(sold && Date.parse(sold.ts) >= slot + 2 * 3600000, 'exit tereksekusi setelah buku pulih');
  const ev = (await store.dumpTable('events')).filter(e => e.type === 'data_tidak_valid');
  assert.ok(ev.some(e => JSON.stringify(e.detail).includes('order_book_kosong')));
  const eq = (await store.dumpTable('equity')).filter(x => x.mode === 'forward');
  assert.ok(eq.every(x => Number.isFinite(x.equity) && x.equity > 0));
});

test('backtest >= 3 tahun: skrip berjalan, menolak data bukan Indodax, dan menolak cakupan kurang dari 3 tahun', { timeout: 200000 }, async () => {
  const cfg = testConfig();
  const start = Math.floor(Date.parse(cfg.schedule.backtest_start_iso) / 1000 / dur) * dur - 330 * dur;
  const n = Math.ceil((Date.parse('2026-11-03T00:00:00Z') / 1000 - start) / dur);
  const candles = { btcidr: syntheticCandles({ startSec: start, n, seed: 5, price: 500000000, inc: 1000 }), ethidr: syntheticCandles({ startSec: start, n, seed: 6, price: 30000000 }), solidr: syntheticCandles({ startSec: start, n, seed: 8, price: 500000 }) };
  const root = project(cfg, candles);
  for (const [p, b] of Object.entries(candles)) writeJ(root, `data/candles/${p}_240.json`, b);
  const biaya = { spreadPct: 0.2, slippagePct: 0.05, n_snapshot: 10 };
  writeJ(root, 'config/biaya_terukur.json', { sumber: 'uji', ukuran_order_idr: 2e7, snapshot_pertama: '2026-11-03T00:00:00Z', snapshot_terakhir: '2026-11-04T00:00:00Z', pasangan: { btcidr: biaya, ethidr: biaya, solidr: biaya } });
  assert.throws(() => run(root, 'backtest.js'), /bukan dari API Indodax/s);
  const out = JSON.parse(run(root, 'backtest.js', '--data-uji'));
  assert.ok(out.equity.years >= 3); assert.ok(out.trades.n_trades > 10);
  assert.ok(Number.isFinite(out.equity.cagr_pct)); assert.ok(out.benchmark);
  run(root, 'hitung_ulang.js'); run(root, 'bangun_dashboard.js');
  const lapBt = JSON.parse(readFileSync(path.join(root, 'hasil/laporan.json'), 'utf8')).backtest;
  assert.ok(lapBt.series_benchmark.length > 1000, 'benchmark mencakup seluruh periode');
  assert.equal(lapBt.series_benchmark.at(-1)[0].slice(0, 7), lapBt.series.at(-1)[0].slice(0, 7));
  assert.ok(Object.keys(lapBt.periodik.bulanan).length >= 36);
  const compounded = Object.values(lapBt.periodik.bulanan).reduce((a, r) => a * (1 + r), 1);
  assert.ok(Math.abs((compounded - 1) * 100 - lapBt.equity.return_pct) < 1e-6, 'return bulanan berantai = return total');
  assert.match(readFileSync(path.join(root, 'UAS_25120200024_Denael.html'), 'utf8'), /DATA UJI SINTETIS/);
  assert.throws(() => run(root, 'catat_freeze.js'), /data uji sintetis/s);
  // Jalur freeze: bukti tercatat, perubahan parameter terdeteksi
  const meta = JSON.parse(readFileSync(path.join(root, 'log_backtest/backtest_meta.json'), 'utf8'));
  delete meta.data_uji; writeJ(root, 'log_backtest/backtest_meta.json', meta);
  run(root, 'catat_freeze.js');
  assert.match(readFileSync(path.join(root, 'README.md'), 'utf8'), /Waktu mulai forward test/);
  assert.throws(() => run(root, 'cek_freeze.js'), 'tanpa .git harus gagal');
  const git = (date, ...a) => execFileSync('git', ['-c', 'user.name=uji', '-c', 'user.email=uji@contoh.invalid', '-c', 'core.autocrlf=false', ...a], { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  const sebelum = '2026-11-04T10:00:00+07:00', sesudah = '2026-11-04T12:30:00+07:00';
  git(sebelum, 'init', '-q'); writeFileSync(path.join(root, '.gitignore'), '.env\nnode_modules/\n'); git(sebelum, 'add', '-A'); git(sebelum, 'commit', '-qm', 'FREEZE'); git(sebelum, 'tag', 'freeze');
  assert.match(run(root, 'cek_freeze.js'), /LOLOS/);
  const bukti = JSON.parse(readFileSync(path.join(root, 'hasil/bukti_freeze.json'), 'utf8'));
  assert.equal(bukti.commit_freeze, git(sebelum, 'rev-parse', 'freeze').trim());
  assert.equal(bukti.jumlah_commit_sesudah_freeze, 0);
  // Commit freeze terlambat harus ditolak
  git(sesudah, 'tag', '-d', 'freeze'); git(sesudah, 'commit', '-q', '--allow-empty', '-m', 'telat'); git(sesudah, 'tag', 'freeze');
  assert.throws(() => run(root, 'cek_freeze.js'), 'commit freeze telat harus gagal');
  git(sebelum, 'tag', '-f', 'freeze', 'HEAD~1');
  assert.match(run(root, 'cek_freeze.js'), /LOLOS/);
  // Paket: .env tidak ikut, .git ikut
  writeFileSync(path.join(root, '.env'), 'DATABASE_URL=rahasia');
  assert.throws(() => run(root, 'buat_paket.js'), 'berkas wajib belum lengkap harus ditolak');
  for (const f of ['log_mentah/calls.json', 'log_mentah/orders.json', 'log_mentah/equity_daily.json', 'log_mentah/errors.json', 'log_mentah/ob_snapshots.json', 'docs/STRATEGI.md', 'docs/REFLEKSI.md', '.env.example', 'scripts/hitung_ulang.js']) { mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); writeFileSync(path.join(root, f), '[]'); }
  writeFileSync(path.join(root, 'bersih.txt'), ''); run(root, 'cek_freeze.js');
  git(sesudah, 'add', '-A'); git(sesudah, 'commit', '-qm', 'akhir');
  const paket = run(root, 'buat_paket.js');
  assert.match(paket, /Paket siap/);
  const zipPath = path.join(root, '..', 'UAS_25120200024_Denael.zip');
  const isi = process.platform === 'linux' ? execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8', maxBuffer: 1 << 28 }) : execFileSync('tar', ['-tf', zipPath], { encoding: 'utf8', maxBuffer: 1 << 28 });
  assert.match(isi, /\.git\/HEAD/); assert.doesNotMatch(isi, /\/\.env\n/); assert.doesNotMatch(isi, /node_modules/);
  rmSync(zipPath, { force: true }); rmSync(path.join(root, '.env'));
  const st = JSON.parse(readFileSync(path.join(root, 'config/strategy.json'), 'utf8'));
  writeJ(root, 'config/strategy.json', { ...st, rsi_entry: 34 });
  assert.throws(() => run(root, 'cek_freeze.js'));
  // Pemeriksa secret
  writeJ(root, 'config/strategy.json', st);
  assert.match(run(root, 'cek_rahasia.js'), /LOLOS.*riwayat git bersih/);
  writeFileSync(path.join(root, 'bocor.txt'), ['postgresql://user', 'sandi@host/db'].join(':'));
  assert.throws(() => run(root, 'cek_rahasia.js'));
  // Secret yang pernah di-commit lalu dihapus tetap terdeteksi di riwayat
  git(sesudah, 'add', '-A'); git(sesudah, 'commit', '-qm', 'bocor'); rmSync(path.join(root, 'bocor.txt')); git(sesudah, 'add', '-A'); git(sesudah, 'commit', '-qm', 'hapus');
  assert.throws(() => run(root, 'cek_rahasia.js'), 'riwayat harus ikut diperiksa');
  // cakupan kurang: dijalankan di folder terpisah
  const root2 = mkdtempSync(path.join(tmpdir(), 'uas-uji-')); cpSync(root, root2, { recursive: true });
  for (const [p, b] of Object.entries(candles)) writeJ(root2, `data/candles/${p}_240.json`, b.slice(0, 2000));
  assert.throws(() => run(root2, 'backtest.js', '--data-uji'), /minimum 3/s);
});

test('endpoint terlindungi: tanpa atau salah secret ditolak 401 sebelum menyentuh apa pun', async () => {
  process.env.CRON_SECRET = 'uji';
  const mk = () => { const r = { code: null, status(c) { r.code = c; return r; }, json() { return r; }, setHeader() {} }; return r; };
  for (const f of ['tick', 'kill', 'catatan', 'health']) {
    const h = (await import(`../api/${f}.js`)).default;
    for (const headers of [{}, { authorization: 'Bearer salah' }]) {
      const res = mk();
      await h({ headers, query: {}, method: 'POST' }, res);
      assert.equal(res.code, 401, f);
    }
  }
  delete process.env.CRON_SECRET;
  const res = mk();
  await (await import('../api/tick.js')).default({ headers: { authorization: 'Bearer ' }, query: {} }, res);
  assert.equal(res.code, 401, 'tanpa CRON_SECRET terpasang, semua ditolak');
});

test('alur harian (alternatif): 3 tahun backtest, forward test, sinyal cocok 100%', { timeout: 200000 }, async () => {
  const cfg = testConfig(); cfg.strategy.timeframe_minutes = 1440; cfg.strategy.tf_param = '1D'; cfg.strategy.window_bars = 200; cfg.rulesHash = rulesHash(cfg);
  const D = 86400, start = Math.floor(Date.parse('2023-01-01T00:00:00Z') / 1000 / D) * D;
  const n = Math.ceil((fwEnd / 1000 - start) / D) + 2;
  const mk = (seed, price, inc) => syntheticCandles({ startSec: start, n, dur: D, seed, price, inc, phase: 240 });
  const candles = { btcidr: mk(3, 1e9, 1000), ethidr: mk(4, 5e7, 1000), solidr: mk(5, 2e6, 1) };
  const { store } = await memStore();
  let now = fwStart - 6 * 3600000 + 180000; const f = fakeExchange({ candles, now: () => now });
  while (now < fwEnd) { const r = await runTick({ store, cfg, createClient: clientFactory(f), nowMs: () => now, source: 't' }); assert.notEqual(r.status, 'error'); now += 3600000; }
  const sig = (await store.dumpTable('signals')).filter(s => s.mode === 'forward');
  assert.ok(sig.length >= 3 * (SLOTS / 24 - 1) && sig.length <= 3 * (SLOTS / 24 + 1), String(sig.length));
  const root = project(cfg, {});
  await exportTo(root, store);
  const closedBy = (b, ms) => b.filter(x => (x.t + D) * 1000 <= ms);
  for (const [p, b] of Object.entries(candles)) { writeJ(root, `data/candles/${p}_1D.json`, closedBy(b, fwStart)); writeJ(root, `data/candles_replay/${p}_1D.json`, closedBy(b, fwEnd + 3600000)); }
  writeJ(root, 'hasil/sumber_tarif.json', { diakses_pada: new Date(fwStart).toISOString(), pasangan: Object.fromEntries(Object.keys(candles).map(p => [p, { qtyInc: 1e-8, minBaseIdr: 10000, minQty: 0.00001, takerPct: 0.2 }])) });
  writeJ(root, 'config/biaya_terukur.json', { sumber: 'uji', ukuran_order_idr: 1e7, snapshot_pertama: JADWAL.forward_start_iso, snapshot_terakhir: JADWAL.forward_start_iso, pasangan: measureCosts((await store.dumpTable('ob_snapshots')).filter(s => s.mode === 'prep'), 1e7) });
  const bt = JSON.parse(run(root, 'backtest.js', '--data-uji'));
  assert.ok(bt.equity.years >= 3); assert.ok(bt.trades.n_trades > 3);
  run(root, 'replay_forward.js', '--data-uji'); run(root, 'hitung_ulang.js'); run(root, 'bangun_dashboard.js');
  const lap = JSON.parse(readFileSync(path.join(root, 'hasil/laporan.json'), 'utf8'));
  assert.equal(lap.gap.signals_match_pct, 100, JSON.stringify(lap.gap.mismatches.slice(0, 5)));
  assert.equal(lap.ops.uptime_pct, 100); assert.equal(lap.audit.fill_di_luar_bid_ask, 0);
  assert.match(run(root, 'hitung_ulang.js', '--cek'), /COCOK/);
});
