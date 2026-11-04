import test from 'node:test';
import assert from 'node:assert/strict';
import { closedOnly, parseCandles, validateWindow } from '../lib/candles.js';
import { atrWilder, ema, rsiWilder, sma } from '../lib/indicators.js';
import { bookIssue, fillBuy, fillModel, fillSell, floorQty, parseBook } from '../lib/orderbook.js';
import { computeStep, decide, entryBudget, evaluateWindow, orderSteps } from '../lib/signal.js';
import { fileURLToPath } from 'node:url';
import { effectiveFee, loadConfig } from '../lib/config.js';
import { equityStats, maxDrawdownPct, measureCosts, tradesFromOrders, tradeStats } from '../lib/metrics.js';
import { modeAt, wibDate, expectedSlots } from '../lib/time.js';
import { createClient } from '../lib/indodax.js';

const P = { timeframe_minutes: 240, window_bars: 5, trend_len: 2, slope_bars: 1, rsi_len: 2, rsi_entry: 50, atr_period: 2, stop_atr: 6, mom_len: 3, adtv_bars: 2, min_adtv_idr: 1000, max_hold_bars: 120, wcap_pct: 25, position_pct: 10, adtv_cap_pct: 5, volume_unit: 'coin' };

test('candle berjalan dibuang: Time detik vs server_time milidetik', () => {
  const dur = 14400, t0 = 1790000000 - (1790000000 % dur);
  const bars = parseCandles([{ Time: t0 - dur, Open: 1, High: 1, Low: 1, Close: 1, Volume: '1' }, { Time: t0, Open: 1, High: 1, Low: 1, Close: 1, Volume: '1' }]);
  const nowMs = (t0 + 100) * 1000;
  assert.deepEqual(closedOnly(bars, 240, nowMs).map(b => b.t), [t0 - dur]);
  assert.equal(closedOnly(bars, 240, (t0 + dur) * 1000).length, 2); // tepat di batas: sudah tertutup
});
test('validasi: candle hilang, volume nol, harga nol, basi, jendela kurang', () => {
  const dur = 14400, base = 1000 * dur;
  const mk = (i, x = {}) => ({ t: base + i * dur, o: 1, h: 1, l: 1, c: 1, v: 1, ...x });
  assert.deepEqual(validateWindow([0, 1, 2, 3, 4].map(i => mk(i)), P), []);
  assert.match(validateWindow([0, 1, 3, 4, 5].map(i => mk(i)), P)[0], /candle_hilang/);
  assert.match(validateWindow([mk(0, { v: 0 }), mk(1), mk(2), mk(3), mk(4)], P)[0], /volume_nol/);
  assert.match(validateWindow([mk(0, { c: 0 }), mk(1), mk(2), mk(3), mk(4)], P)[0], /harga_nol/);
  assert.match(validateWindow([mk(0), mk(1)], P)[0], /jendela_kurang/);
  const w = [0, 1, 2, 3, 4].map(i => mk(i)), close = w[4].t + dur;
  assert.deepEqual(validateWindow(w, P, close + 2 * dur), []);
  assert.match(validateWindow(w, P, close + 2 * dur + 1)[0], /candle_basi/);
});
test('indikator: nilai terhitung tangan', () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2).slice(1), [1.5, 2.5, 3.5]);
  assert.deepEqual(ema([1, 2, 3], 2).slice(1), [1.5, 2.5]); // k=2/3: 3*(2/3)+1.5*(1/3)=2.5
  assert.equal(rsiWilder([1, 2, 3], 2)[2], 100);
  assert.equal(rsiWilder([3, 2, 1], 2)[2], 0);
  assert.equal(atrWilder([2, 3, 4], [1, 2, 3], [1.5, 2.5, 3.5], 2)[2], 1.5); // TR: 1.5, 1.5 -> (1.5+1.5)/2
});
test('fill: beli di ask, jual di bid, menghabiskan level, bukan mid', () => {
  const book = parseBook({ buy: [[99, '1'], [98, '2']], sell: [[101, '1'], ['102', '2']] });
  const b = fillBuy(book, 203.0 * 1.01, 0.01, { qtyInc: 0.0001 });
  assert.equal(b.qty, 2); assert.equal(b.avgFill, 101.5); assert.equal(b.levelsUsed, 2);
  assert.ok(Math.abs(b.fee - 2.03) < 1e-9);
  assert.ok(Math.abs(b.spreadCost - 2 * 1) < 1e-9); assert.ok(Math.abs(b.slippageCost - 2 * 0.5) < 1e-9);
  const s = fillSell(book, 2, 0.02, { qtyInc: 0.0001 });
  assert.equal(s.avgFill, 98.5); assert.ok(Math.abs(s.fee - 3.94) < 1e-9);
  assert.equal(s.bestBid, 99); assert.equal(s.bestAsk, 101);
  assert.notEqual(s.avgFill, 100);
});
test('fill: order lebih besar dari seluruh buku menjadi parsial', () => {
  const book = parseBook({ buy: [[99, '1']], sell: [[101, '1']] });
  const s = fillSell(book, 5, 0, { qtyInc: 0.0001 });
  assert.equal(s.qty, 1); assert.equal(s.partial, true);
});
test('pembulatan kuantitas mengikuti quantity_increment', () => {
  assert.equal(floorQty(1.23456789123, 0.00000001), 1.23456789);
  assert.equal(floorQty(12.9, 1), 12);
  let seed = 12345;
  for (let i = 0; i < 200000; i++) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    const q = Number((seed / 4294967296 * 5000).toFixed(8));
    assert.equal(floorQty(q, 0.00000001), q);
  }
  assert.equal(floorQty(1.234567899, 0.00000001), 1.23456789);
});
test('order book: kosong, tersilang, spread lebih dari 2%', () => {
  assert.equal(bookIssue(parseBook({ buy: [], sell: [] }), 2), 'order_book_kosong');
  assert.equal(bookIssue(parseBook({ buy: [[100, '1']], sell: [[100, '1']] }), 2), 'order_book_tersilang');
  assert.match(bookIssue(parseBook({ buy: [[100, '1']], sell: [[103, '1']] }), 2), /spread_lebar/);
  assert.equal(bookIssue(parseBook({ buy: [[100, '1']], sell: [[101, '1']] }), 2), null);
});
test('fee: memakai yang lebih mahal per sisi; kosong jika tarif resmi belum diisi', () => {
  assert.deepEqual(effectiveFee({ official_taker_buy_pct: 0.2, official_taker_sell_pct: 0.4 }, 0.3).buyPct, 0.3);
  assert.deepEqual(effectiveFee({ official_taker_buy_pct: 0.2, official_taker_sell_pct: 0.4 }, 0.3).sellPct, 0.4);
  assert.equal(effectiveFee({ official_taker_buy_pct: null, official_taker_sell_pct: null }, 0.3), null);
});
test('sizing: 10% equity, dibatasi 5% ADTV dan kas', () => {
  const p = { position_pct: 10, adtv_cap_pct: 5 };
  assert.equal(entryBudget({ equity: 1e8, cash: 1e8, adtv: 1e9 }, p), 1e7);
  assert.equal(entryBudget({ equity: 1e8, cash: 1e8, adtv: 1e8 }, p), 5e6);
  assert.equal(entryBudget({ equity: 1e8, cash: 3e6, adtv: 1e9 }, p), 3e6);
});
test('masuk: tren naik, SMA menanjak, RSI di bawah ambang, likuid', () => {
  // Close naik lalu koreksi: 10,11,12,14,13. SMA2 akhir 13,5; sebelumnya 13; Close 13 < SMA -> bukan tren.
  const mk = (cs, v = 100) => cs.map((c, i) => ({ t: i, o: c, h: c + 1, l: c - 1, c, v }));
  let ev = evaluateWindow(mk([10, 11, 12, 14, 13]), P);
  assert.equal(ev.trendUp, false);
  // 10,12,14,13,15: SMA2 14 > 13,5; Close 15 > 14 -> tren naik; kenaikan terakhir membuat RSI tinggi -> bukan pullback.
  ev = evaluateWindow(mk([10, 12, 14, 13, 15]), P);
  assert.equal(ev.trendUp, true); assert.ok(Math.abs(ev.sma - 14) < 1e-9); assert.equal(ev.pullback, false); assert.equal(ev.entrySetup, false);
  // Momentum dan ADTV: 15/12-1; rata-rata (13*100+15*100)/2 x 6 bar per hari.
  assert.ok(Math.abs(ev.mom - 0.25) < 1e-9); assert.equal(ev.adtv, 8400);
  assert.equal(evaluateWindow(mk([10, 12, 14, 13, 15], 1), P).liquid, false);
  assert.equal(evaluateWindow(mk([10, 12, 14, 13, 15], 1), { ...P, volume_unit: 'idr' }).adtv, 6);
  const buy = decide(null, { entrySetup: true, close: 100, atr: 2, adtv: 1e9 }, 7, P);
  assert.equal(buy.raw, 'BUY'); assert.equal(buy.pos.stopLevel, 88); assert.equal(buy.pos.refPrice, 100); assert.equal(buy.adtv, 1e9);
  assert.equal(decide(null, { entrySetup: false }, 7, P).raw, 'NONE');
});
test('keluar: stop trailing, trend patah, batas waktu, batas bobot; level stop naik saja', () => {
  const pos = { module: 'PULLBACK', refPrice: 100, stopLevel: 88, highestClose: 100, barsHeld: 1 };
  const ev = { close: 110, low: 108, sma: 100, atr: 2 };
  let d = decide(pos, ev, 1, P, { positionValue: 10, equity: 100 });
  assert.equal(d.raw, 'HOLD'); assert.equal(d.pos.stopLevel, 98); assert.equal(d.pos.highestClose, 110); assert.equal(d.pos.barsHeld, 2);
  // Stop memakai level lama, bukan level yang baru naik dari candle yang sama
  assert.equal(decide(pos, { ...ev, low: 89 }, 1, P).raw, 'HOLD');
  assert.equal(decide(pos, { ...ev, low: 88 }, 1, P).reason, 'stop_trailing');
  assert.equal(decide({ ...pos, stopLevel: 98 }, { ...ev, close: 90, low: 99, atr: 0.1 }, 1, P).pos.stopLevel, 109.4 > 98 ? Math.max(98, 100 - 0.6) : 98);
  assert.equal(decide(pos, { ...ev, close: 99 }, 1, P).reason, 'trend_patah');
  assert.equal(decide({ ...pos, barsHeld: 119 }, ev, 1, P).reason, 'batas_waktu');
  assert.equal(decide(pos, ev, 1, P, { positionValue: 26, equity: 100 }).reason, 'batas_bobot');
  assert.equal(decide(pos, ev, 1, P, { positionValue: 25, equity: 100 }).raw, 'HOLD');
});
test('urutan kandidat: berposisi dulu, lalu Mom tertinggi, seri menurut abjad', () => {
  const it = (pair, mom) => ({ pair, step: { ev: { mom } } });
  const o = orderSteps([it('a', 0.1), it('b', 0.5), it('c', 0.5), it('d', -1)], { d: {} });
  assert.deepEqual(o.map(x => x.pair), ['d', 'b', 'c', 'a']);
});
test('data rusak: harga nol tidak memicu sinyal', () => {
  const win = [0, 1, 2, 3, 4].map(i => ({ t: i * 14400, o: 1, h: 1, l: 1, c: i === 2 ? 0 : 1, v: 1 }));
  const s = computeStep(win, null, { ...P, window_bars: 5 });
  assert.equal(s.decision.raw, 'NONE'); assert.equal(s.ev, null);
});
test('metrik: drawdown, statistik trade, porsi biaya, biaya terukur', () => {
  assert.ok(Math.abs(maxDrawdownPct([100, 120, 90, 130]) - (-25)) < 1e-9);
  const eq = equityStats([{ equity: 110 }], 100, { withCagr: true, startMs: 0, endMs: 365.25 * 86400000 });
  assert.ok(Math.abs(eq.cagr_pct - 10) < 1e-9);
  const o = (id, side, qty, n, fee, spread, slip, pair = 'a') => ({ mode: 'x', position_id: id, side, qty, notional_idr: n, fee_idr: fee, spread_cost_idr: spread, slippage_cost_idr: slip, avg_fill: n / qty, pair, ts: `2026-01-0${id}`, signal_candle: 1 });
  const t = tradesFromOrders([o(1, 'BUY', 1, 100, 1, 1, 0), o(1, 'SELL', 1, 120, 1, 1, 0), o(2, 'BUY', 1, 100, 1, 1, 0), o(2, 'SELL', 1, 95, 1, 1, 0), o(3, 'BUY', 1, 100, 1, 0, 0)]);
  assert.equal(t.length, 2); // posisi terbuka tidak dihitung
  const s = tradeStats(t);
  assert.equal(s.net_pnl_idr, 18 - 7); assert.equal(s.win_rate_pct, 50);
  assert.ok(Math.abs(s.profit_factor - 18 / 7) < 1e-9);
  assert.equal(s.cost_idr, 8); assert.ok(Math.abs(s.cost_share_pct - 8 / 19 * 100) < 1e-9);
  const m = measureCosts([{ pair: 'a', ts: '2026-11-03T00:00:00Z', bids: [[99, 10]], asks: [[101, 1], [102, 10]] }], 202);
  assert.ok(Math.abs(m.a.spreadPct - 2) < 1e-9);
  assert.ok(m.a.slippagePct > 0);
});
test('hari WIB berganti pukul 17.00 UTC', () => {
  assert.equal(wibDate(Date.parse('2026-11-05T16:59:59Z')), '2026-11-05');
  assert.equal(wibDate(Date.parse('2026-11-05T17:00:00Z')), '2026-11-06');
});
test('jadwal sesuai ketentuan terbaru: freeze Rabu 4 Nov 12.00 WIB, 10 hari, 240 slot', () => {
  const s = loadConfig(fileURLToPath(new URL('..', import.meta.url))).schedule;
  assert.equal(Date.parse(s.forward_start_iso), Date.parse('2026-11-04T12:00:00+07:00'));
  assert.equal(Date.parse(s.forward_end_iso), Date.parse('2026-11-14T12:00:00+07:00'));
  assert.equal(expectedSlots(Date.parse(s.forward_start_iso), Date.parse(s.forward_end_iso)).length, 240);
  assert.equal(modeAt(Date.parse(s.forward_start_iso) - 1000, s), 'prep');
  assert.equal(modeAt(Date.parse(s.forward_start_iso), s), 'forward');
  assert.equal(modeAt(Date.parse(s.forward_end_iso), s), 'post');
  assert.ok((Date.parse('2026-11-03T00:00:00Z') - Date.parse(s.backtest_start_iso)) / (365.25 * 864e5) >= 3, 'backtest >= 3 tahun');
});
test('konfigurasi aktif: candle 4 jam dengan nilai parameter UTS', () => {
  const p = loadConfig(fileURLToPath(new URL('..', import.meta.url))).strategy;
  assert.equal(p.timeframe_minutes, 240); assert.equal(p.tf_param, '240');
  assert.deepEqual([p.trend_len, p.slope_bars, p.rsi_len, p.rsi_entry, p.stop_atr, p.atr_period, p.mom_len, p.max_hold_bars, p.wcap_pct, p.position_pct, p.max_open_positions, p.adtv_cap_pct, p.min_adtv_idr], [150, 20, 3, 50, 6, 14, 126, 120, 25, 10, 10, 5, 1e9]);
  assert.ok(p.window_bars >= p.trend_len + p.slope_bars);
});
test('klien API: retry terbatas, timeout, respons kosong dicatat', async () => {
  const errs = []; let n = 0;
  const c = createClient({ fetchImpl: async () => { n++; return { ok: true, status: 200, text: async () => '' }; }, onError: e => errs.push(e), minGapMs: 0, sleep: async () => {} });
  await assert.rejects(c.pairs());
  assert.equal(n, 3); assert.equal(errs.length, 3); assert.match(errs[0].message, /kosong/);
  const c2 = createClient({ fetchImpl: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))), onError: e => errs.push(e), minGapMs: 0, timeoutMs: 5, maxAttempts: 1, sleep: async () => {} });
  await assert.rejects(c2.pairs());
  assert.match(errs.at(-1).message, /timeout/);
});
test('model backtest: bukan close, ada spread dan slippage', () => {
  const f = fillModel('BUY', 100, { spreadPct: 1, slippagePct: 0.1 }, { budgetIdr: 1000 }, 0.002, { qtyInc: 1e-8 });
  assert.ok(Math.abs(f.bestAsk - 100.5) < 1e-9); assert.ok(Math.abs(f.avgFill - 100.6005) < 1e-9);
  assert.ok(f.notional + f.fee <= 1000);
});
