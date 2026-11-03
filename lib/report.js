// Menyusun laporan dari log mentah. Tidak ada angka yang ditulis tangan.
import { benchmarkFromCandles, benchmarkFromSnapshots, equityStats, median, tradesFromOrders, tradeStats } from './metrics.js';
import { expectedSlots, iso, slotUtcMs } from './time.js';

const EXECUTED = new Set(['ok', 'ok_with_errors']);
const compactSeries = s => s.map(x => [x.ts, x.equity]);
const parseMaybe = v => (typeof v === 'string' ? JSON.parse(v) : v);

export function buildBacktestSection(bt, candlesBtc, cfg) {
  const p = cfg.strategy, m = bt.meta;
  const startMs = m.start_sec * 1000, endMs = m.end_sec * 1000;
  const trades = tradesFromOrders(bt.orders);
  const bench = benchmarkFromCandles(candlesBtc, { startSec: m.start_sec, endSec: m.end_sec, dur: p.timeframe_minutes * 60, fee: m.fee, cost: m.costs.btcidr || m.benchmark_cost });
  return {
    window: { start: iso(startMs), end: iso(endMs) },
    data_uji: Boolean(m.data_uji),
    data_sha: m.data_sha ?? null,
    fee: m.fee, costs: m.costs,
    equity: equityStats(bt.equity, p.initial_capital_idr, { withCagr: true, startMs, endMs }),
    trades: tradeStats(trades),
    benchmark: bench ? { return_pct: bench.return_pct, max_drawdown_pct: bench.max_drawdown_pct } : null,
    block_counts: m.block_counts || {},
    open_positions_end: m.open_positions || [],
    series: compactSeries(bt.equity),
    series_benchmark: bench ? bench.series.map(x => [x.ts, x.equity * p.initial_capital_idr]) : [],
    trade_list: trades,
    periodik: periodReturns(bt.equity, p.initial_capital_idr),
  };
}
// Return bulanan dan tahunan: ekuitas akhir periode / ekuitas akhir periode sebelumnya - 1 (kalender WIB).
export function periodReturns(series, capital) {
  const key = (x, n) => new Date(Date.parse(x.ts) + 7 * 3600000).toISOString().slice(0, n);
  const roll = n => {
    const out = {}; let prev = capital, cur = null, last = capital;
    for (const x of series) {
      const k = key(x, n);
      if (cur !== null && k !== cur) { out[cur] = last / prev - 1; prev = last; }
      cur = k; last = x.equity;
    }
    if (cur !== null) out[cur] = last / prev - 1;
    return out;
  };
  return { bulanan: roll(7), tahunan: roll(4) };
}
// Audit otomatis dari log forward terhadap red flag soal.
export function buildAudit(logs, cfg, mode = 'forward') {
  const orders = logs.orders.filter(o => o.mode === mode), p = cfg.strategy;
  const badFill = orders.filter(o => (o.side === 'BUY' ? o.avg_fill < o.best_ask : o.avg_fill > o.best_bid)).length;
  const atMid = orders.filter(o => o.avg_fill === (o.best_bid + o.best_ask) / 2).length;
  const belowMin = orders.filter(o => o.side === 'BUY' && o.notional_idr < p.min_order_idr).length;
  const feeLow = orders.filter(o => { const ref = Math.max(o.fee_api_pct ?? 0, (o.side === 'BUY' ? o.fee_official_buy_pct : o.fee_official_sell_pct) ?? 0); return o.fee_rate * 100 < ref - 1e-9; }).length;
  const calls = logs.calls.filter(c => c.mode === mode);
  return { n_orders: orders.length, fill_di_luar_bid_ask: badFill, fill_di_mid: atMid, order_di_bawah_minimum: belowMin, fee_lebih_murah_dari_sumber: feeLow, rules_hash_unik: new Set(calls.map(c => c.rules_hash)).size };
}
export function buildForwardSection(logs, cfg, mode = 'forward') {
  const p = cfg.strategy;
  const f = r => r.filter(x => x.mode === mode);
  const orders = f(logs.orders), equity = f(logs.equity), snaps = f(logs.ob_snapshots).filter(s => s.pair === 'btcidr');
  const trades = tradesFromOrders(orders);
  const feeBuy = Math.max(cfg.fees.official_taker_buy_pct ?? 0, ...orders.filter(o => o.side === 'BUY').map(o => o.fee_rate * 100));
  const bench = benchmarkFromSnapshots(snaps, feeBuy);
  return {
    equity: equityStats(equity, p.initial_capital_idr),
    trades: tradeStats(trades),
    trade_list: trades,
    n_orders: orders.length,
    benchmark: bench ? { return_pct: bench.return_pct, max_drawdown_pct: bench.max_drawdown_pct, n_points: bench.n_points } : null,
    series: compactSeries(equity),
    series_benchmark: bench ? bench.series.map(x => [x.ts, x.equity * p.initial_capital_idr]) : [],
    equity_daily: f(logs.equity_daily).map(x => ({ wib_date: x.wib_date, ts: x.ts, equity: x.equity })),
  };
}
export function buildOps(logs, cfg, nowMs = null, mode = 'forward') {
  const s = cfg.schedule;
  const startMs = Date.parse(s.forward_start_iso);
  const endMs = Math.min(Date.parse(s.forward_end_iso), nowMs ?? Infinity);
  const calls = logs.calls.filter(c => c.mode === mode);
  const expected = mode === 'forward' ? expectedSlots(startMs, endMs, s.tick_interval_minutes).length : null;
  const done = new Set(calls.filter(c => EXECUTED.has(c.status)).map(c => slotUtcMs(Date.parse(c.slot_utc), s.tick_interval_minutes)));
  const by = {}; for (const c of calls) by[c.status] = (by[c.status] || 0) + 1;
  const bySrc = {}; for (const c of calls) bySrc[c.source] = (bySrc[c.source] || 0) + 1;
  const delays = calls.filter(c => EXECUTED.has(c.status)).map(c => (Date.parse(c.started_at) - Date.parse(c.slot_utc)) / 60000);
  const errs = logs.errors.filter(e => e.mode === mode), evs = logs.events.filter(e => e.mode === mode);
  const errScope = {}; for (const e of errs) errScope[e.scope] = (errScope[e.scope] || 0) + 1;
  const count = t => evs.filter(e => e.type === t).length;
  const uptime = expected ? done.size / expected * 100 : null;
  return {
    scheduled: expected, executed_slots: done.size, total_calls: calls.length, uptime_pct: uptime,
    uptime_tier: uptime === null ? null : uptime >= 95 ? 'penuh (>=95%)' : uptime >= 80 ? 'sebagian (80-95%)' : 'rendah (<80%)',
    status_counts: by, source_counts: bySrc, median_delay_min: median(delays), max_delay_min: delays.length ? Math.max(...delays) : null,
    api_errors: errs.length, error_scopes: errScope,
    kill_switch_on: count('kill_switch_on'), kill_switch_off: count('kill_switch_off'), daily_loss_limit_events: count('daily_loss_limit'),
    data_invalid_events: count('data_tidak_valid'), bugfix_events: evs.filter(e => e.type === 'perbaikan_bug').map(e => ({ ts: e.ts, detail: parseMaybe(e.detail) })),
    rules_hashes: [...new Set(calls.map(c => c.rules_hash))],
    git_shas: [...new Set(calls.map(c => c.git_sha).filter(Boolean))],
  };
}
// Blok eksekusi dari log forward, agar replay mengikuti jalur posisi yang sama.
export function externalBlocksFromLogs(signals) {
  const out = {};
  for (const s of signals) {
    if (s.mode !== 'forward' || s.final_action !== 'BLOCKED') continue;
    const r = String(s.block_reason || '');
    // Batas posisi, minimum order, dan data rusak muncul sendiri di replay; candle basi hanya ada di bot.
    if (r === 'batas_posisi' || r === 'di_bawah_minimum_order' || (r.startsWith('data_tidak_valid') && !r.includes('candle_basi'))) continue;
    out[`${s.pair}|${s.candle_time}`] = r;
  }
  return out;
}
const cleanInvalid = v => (parseMaybe(v) || []).filter(r => !String(r).startsWith('candle_basi')).map(r => String(r).split(':')[0]).sort().join(',');

export function buildGapSection(logs, replay, cfg) {
  const fw = logs.signals.filter(s => s.mode === 'forward');
  const rp = replay.signals;
  const key = s => `${s.pair}|${s.candle_time}`;
  const fm = new Map(fw.map(s => [key(s), s])), rm = new Map(rp.map(s => [key(s), s]));
  let match = 0; const mismatches = [];
  let hashSame = 0, hashDiff = 0, entryExit = 0, entryExitMatch = 0;
  for (const k of new Set([...fm.keys(), ...rm.keys()])) {
    const a = fm.get(k), b = rm.get(k);
    if (!a || !b) { mismatches.push({ key: k, jenis: !a ? 'tidak_diproses_forward' : 'tidak_ada_di_replay', forward: a?.raw_action ?? null, replay: b?.raw_action ?? null }); continue; }
    if (a.window_hash && b.window_hash) { if (a.window_hash === b.window_hash) hashSame++; else hashDiff++; }
    const isEE = x => x.raw_action === 'BUY' || x.raw_action === 'SELL';
    if (isEE(a) || isEE(b)) { entryExit++; if (a.raw_action === b.raw_action && a.module === b.module) entryExitMatch++; }
    if (a.raw_action === b.raw_action && a.module === b.module && cleanInvalid(a.invalid_reasons) === cleanInvalid(b.invalid_reasons)) match++;
    else mismatches.push({ key: k, jenis: 'beda_sinyal', forward: a.raw_action, replay: b.raw_action, hash_sama: a.window_hash === b.window_hash });
  }
  const total = match + mismatches.length;
  const p = cfg.strategy;
  const rEq = equityStats(replay.equity, p.initial_capital_idr);
  const fEq = equityStats(logs.equity.filter(x => x.mode === 'forward'), p.initial_capital_idr);
  const rT = tradeStats(tradesFromOrders(replay.orders)), fT = tradeStats(tradesFromOrders(logs.orders.filter(o => o.mode === 'forward')));

  // Selisih harga fill per order. Sisi beli: positif = forward lebih mahal. Sisi jual: positif = forward lebih murah (merugikan).
  const fills = [];
  const fo = logs.orders.filter(o => o.mode === 'forward');
  const ok = (o) => `${o.pair}|${o.side}|${o.signal_candle}`;
  const rMap = new Map(replay.orders.map(o => [ok(o), o]));
  for (const o of fo) {
    const r = rMap.get(ok(o));
    if (!r) { fills.push({ key: ok(o), ts: o.ts, forward_fill: o.avg_fill, replay_fill: null, catatan: 'tidak_ada_pasangan_di_replay' }); continue; }
    const sgn = o.side === 'BUY' ? 1 : -1;
    const fMid = (o.best_bid + o.best_ask) / 2, rMid = (r.best_bid + r.best_ask) / 2;
    const total_pct = sgn * (o.avg_fill - r.avg_fill) / r.avg_fill * 100;
    const delay_pct = sgn * (fMid - rMid) / rMid * 100;
    const spread_pct = ((o.best_ask - o.best_bid) / 2 / fMid - (r.best_ask - r.best_bid) / 2 / rMid) * 100;
    const fBest = o.side === 'BUY' ? o.best_ask : o.best_bid, rBest = o.side === 'BUY' ? r.best_ask : r.best_bid;
    const slippage_pct = (Math.abs(o.avg_fill - fBest) / fBest - Math.abs(r.avg_fill - rBest) / rBest) * 100;
    fills.push({ key: ok(o), ts: o.ts, side: o.side, pair: o.pair, forward_fill: o.avg_fill, replay_fill: r.avg_fill, total_pct, delay_pct, spread_pct, slippage_pct, sisa_pct: total_pct - delay_pct - spread_pct - slippage_pct, signal_price: o.signal_price, diff_vs_signal_pct: o.diff_vs_signal_pct });
  }
  const paired = fills.filter(x => x.replay_fill !== null);
  const avg = k => paired.length ? paired.reduce((a, x) => a + x[k], 0) / paired.length : null;
  return {
    window: { start: cfg.schedule.forward_start_iso, end: cfg.schedule.forward_end_iso },
    signals_total: total, signals_match: match, signals_match_pct: total ? match / total * 100 : null,
    entry_exit_total: entryExit, entry_exit_match: entryExitMatch,
    window_hash_same: hashSame, window_hash_diff: hashDiff,
    mismatches: mismatches.slice(0, 50), n_mismatches: mismatches.length,
    forward_return_pct: fEq.return_pct, replay_return_pct: rEq.return_pct, gap_return_pp: fEq.return_pct - rEq.return_pct,
    forward_mdd_pct: fEq.max_drawdown_pct, replay_mdd_pct: rEq.max_drawdown_pct,
    forward_trades: fT.n_trades, replay_trades: rT.n_trades,
    forward_orders: fo.length, replay_orders: replay.orders.length,
    forward_cost_idr: fT.cost_idr, replay_cost_idr: rT.cost_idr,
    fills, fill_avg: { total_pct: avg('total_pct'), delay_pct: avg('delay_pct'), spread_pct: avg('spread_pct'), slippage_pct: avg('slippage_pct'), sisa_pct: avg('sisa_pct') },
    series_replay: compactSeries(replay.equity),
  };
}
export function identity(cfg) {
  return { nama: 'Denael', nim: '25120200024', mata_kuliah: 'Algorithmic Trading', strategi: cfg.strategy.nama, timeframe_menit: cfg.strategy.timeframe_minutes, parameter: cfg.strategy, jadwal: cfg.schedule, universe: cfg.universe.pairs, universe_status: cfg.universe.status, rules_hash: cfg.rulesHash, modal: cfg.strategy.initial_capital_idr, jendela_forward: { start: cfg.schedule.forward_start_iso, end: cfg.schedule.forward_end_iso }, fee_sumber: cfg.fees };
}
