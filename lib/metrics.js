// Metrik murni. Satu-satunya sumber angka untuk dashboard Vercel, dashboard offline, dan hitung_ulang.
export function tradesFromOrders(orders) {
  const byPos = new Map();
  for (const o of orders) {
    const key = `${o.mode}|${o.position_id}`;
    if (!byPos.has(key)) byPos.set(key, []);
    byPos.get(key).push(o);
  }
  const trades = [];
  for (const list of byPos.values()) {
    const buy = list.find(o => o.side === 'BUY'); const sells = list.filter(o => o.side === 'SELL');
    if (!buy || !sells.length) continue;
    const soldQty = sells.reduce((a, o) => a + o.qty, 0);
    if (soldQty < buy.qty - 1e-9) continue;
    const proceeds = sells.reduce((a, o) => a + o.notional_idr - o.fee_idr, 0);
    const net = proceeds - (buy.notional_idr + buy.fee_idr);
    const sum = k => buy[k] + sells.reduce((a, o) => a + o[k], 0);
    const fee = sum('fee_idr'), spread = sum('spread_cost_idr'), slip = sum('slippage_cost_idr');
    trades.push({
      pair: buy.pair, module: buy.module, position_id: buy.position_id, entry_ts: buy.ts, exit_ts: sells.at(-1).ts,
      entry_candle: buy.signal_candle, exit_candle: sells.at(-1).signal_candle, exit_reason: sells.at(-1).reason,
      qty: buy.qty, entry_fill: buy.avg_fill, exit_fill: sells.reduce((a, o) => a + o.avg_fill * o.qty, 0) / soldQty,
      net_pnl: net, net_pct: net / (buy.notional_idr + buy.fee_idr) * 100, fee, spread, slippage: slip, cost: fee + spread + slip, gross_pnl: net + fee + spread + slip,
    });
  }
  return trades.sort((a, b) => a.exit_ts < b.exit_ts ? -1 : 1);
}
export function maxDrawdownPct(values) {
  let peak = -Infinity, mdd = 0;
  for (const v of values) { if (v > peak) peak = v; if (peak > 0) mdd = Math.min(mdd, v / peak - 1); }
  return mdd * 100;
}
export function tradeStats(trades) {
  const wins = trades.filter(t => t.net_pnl > 0), losses = trades.filter(t => t.net_pnl <= 0);
  const sum = (a, k) => a.reduce((x, t) => x + t[k], 0);
  const gw = sum(wins, 'net_pnl'), gl = -sum(losses, 'net_pnl');
  const cost = sum(trades, 'cost'), gross = sum(trades, 'gross_pnl');
  return {
    n_trades: trades.length, win_rate_pct: trades.length ? wins.length / trades.length * 100 : null,
    profit_factor: gl > 0 ? gw / gl : null, profit_factor_note: gl > 0 ? null : (gw > 0 ? 'tanpa_trade_rugi' : 'tanpa_trade'),
    avg_win_idr: wins.length ? gw / wins.length : null, avg_loss_idr: losses.length ? -gl / losses.length : null,
    net_pnl_idr: sum(trades, 'net_pnl'), gross_profit_idr: gross,
    fee_idr: sum(trades, 'fee'), spread_idr: sum(trades, 'spread'), slippage_idr: sum(trades, 'slippage'), cost_idr: cost,
    cost_share_pct: gross > 0 ? cost / gross * 100 : null,
  };
}
export function equityStats(series, capital, { withCagr = false, startMs, endMs } = {}) {
  const vals = series.map(x => x.equity);
  const end = vals.length ? vals[vals.length - 1] : capital;
  const out = { capital, end_equity: end, return_pct: (end / capital - 1) * 100, max_drawdown_pct: maxDrawdownPct([capital, ...vals]) };
  if (withCagr) {
    const yrs = (endMs - startMs) / (365.25 * 86400000);
    out.years = yrs; out.cagr_pct = (Math.pow(end / capital, 1 / yrs) - 1) * 100;
  }
  return out;
}
export function median(a) {
  const s = [...a].filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function benchmarkFromCandles(bars, { startSec, endSec, dur, fee, cost }) {
  const inWin = bars.filter(b => b.t + dur > startSec && b.t + dur < endSec);
  if (!inWin.length) return null;
  const hs = cost.spreadPct / 200, sl = cost.slippagePct / 100;
  const entry = inWin[0].o * (1 + hs) * (1 + sl) * (1 + fee.buyPct / 100);
  const series = inWin.map(b => ({ ts: new Date((b.t + dur) * 1000).toISOString(), equity: b.c * (1 - hs) / entry }));
  return { return_pct: (series.at(-1).equity - 1) * 100, max_drawdown_pct: maxDrawdownPct(series.map(x => x.equity)), n_points: series.length, series };
}
export function benchmarkFromSnapshots(snaps, feeBuyPct) {
  const list = snaps.filter(s => s.best_ask > 0 && s.best_bid > 0);
  if (!list.length) return null;
  const entry = list[0].best_ask * (1 + feeBuyPct / 100);
  const series = list.map(s => ({ ts: s.ts, equity: s.best_bid / entry }));
  return { return_pct: (series.at(-1).equity - 1) * 100, max_drawdown_pct: maxDrawdownPct(series.map(x => x.equity)), n_points: series.length, series };
}
// Spread dan slippage dari snapshot mentah untuk ukuran order tertentu.
export function measureCosts(snaps, orderIdr) {
  const by = {};
  for (const s of snaps) (by[s.pair] ||= []).push(s);
  const out = {};
  for (const [pair, list] of Object.entries(by)) {
    const spreads = [], slips = []; const dates = new Set();
    for (const s of list) {
      const bids = parseLv(s.bids), asks = parseLv(s.asks);
      if (!bids.length || !asks.length) continue;
      const bb = bids[0][0], ba = asks[0][0];
      spreads.push((ba - bb) / ((ba + bb) / 2) * 100);
      dates.add(String(s.ts).slice(0, 10));
      const buy = avgForQuote(asks, orderIdr), sell = avgForQuote(bids, orderIdr);
      const a = buy === null ? null : (buy - ba) / ba * 100, b = sell === null ? null : (bb - sell) / bb * 100;
      if (a !== null && b !== null) slips.push((a + b) / 2);
    }
    out[pair] = { n_snapshot: list.length, n_hari: dates.size, spreadPct: median(spreads), slippagePct: median(slips), n_cukup_dalam: slips.length };
  }
  return out;
}
function parseLv(v) { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a : []; }
function avgForQuote(levels, idr) {
  let left = idr, qty = 0;
  for (const [p, q] of levels) {
    const c = p * q;
    if (c >= left) { qty += left / p; left = 0; break; }
    qty += q; left -= c;
  }
  return left > 0 ? null : idr / qty; // null: kedalaman yang tersimpan tidak cukup
}
