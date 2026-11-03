// Backtest dan replay. Memakai computeStep/entryBudget/processingOrder yang SAMA dengan bot.
// Keputusan dari candle tertutup t; eksekusi di Open bar berikutnya + spread & slippage terukur + fee taker.
import { computeStep, entryBudget, orderSteps } from './signal.js';
import { fillModel } from './orderbook.js';
import { applyBuy, applySell, markEquity, newPortfolio, orderRecord } from './portfolio.js';
import { minOrderIdr } from './config.js';
import { wibDate } from './time.js';

export function runBacktest({ candlesByPair, universe, p, fee, costs, meta = {}, startSec, endSec, mode = 'backtest', externalBlocks = {}, collectSignals = false, withHash = false }) {
  const dur = p.timeframe_minutes * 60;
  const index = {};
  for (const pair of universe) index[pair] = new Map(candlesByPair[pair].map((b, i) => [b.t, i]));
  const grid = new Set();
  for (const pair of universe) for (const b of candlesByPair[pair]) {
    const closeT = b.t + dur;
    if (closeT > startSec && closeT < endSec) grid.add(b.t);
  }
  const times = [...grid].sort((a, b) => a - b);

  let pf = newPortfolio(p.initial_capital_idr);
  const orders = [], equity = [], equityDaily = [], signals = [], blockCounts = {};
  const events = [];
  let lastBar = {};
  const bidOf = pair => lastBar[pair] ? lastBar[pair] * (1 - costs[pair].spreadPct / 200) : undefined;
  let dayKey = null, dayStart = null, dllDay = null;

  for (const t of times) {
    const closeMs = (t + dur) * 1000;
    // Harga acuan penilaian saat ini = Close bar sinyal dikurangi setengah spread (pendekatan best bid)
    for (const pair of universe) {
      const i = index[pair].get(t);
      if (i !== undefined) lastBar[pair] = candlesByPair[pair][i].c;
    }
    const wib = wibDate(closeMs);
    if (wib !== dayKey) {
      dayKey = wib; dayStart = markEquity(pf, bidOf).equity;
      equityDaily.push({ mode, wib_date: wib, ts: new Date(closeMs).toISOString(), equity: dayStart });
    }
    const dllHit = () => {
      if (dllDay === wib) return true; // Terkunci sampai 00.00 WIB berikutnya, meski equity pulih.
      if ((markEquity(pf, bidOf).equity / dayStart - 1) * 100 <= -p.daily_loss_limit_pct) { dllDay = wib; return true; }
      return false;
    };

    const nextBar = pair => {
      const i = index[pair].get(t + dur);
      return i === undefined ? null : candlesByPair[pair][i];
    };
    const sell = (pair, qty, ctx, nb) => {
      const fill = fillModel('SELL', nb.o, costs[pair], { qtyWanted: qty }, fee.sellPct / 100, meta[pair]);
      if (!fill) return null;
      const posId = applySell(pf, pair, fill);
      orders.push(orderRecord({ mode, ts: (t + dur) * 1000, pair, fill, signalPrice: ctx.signalPrice, signalCandle: ctx.candle, positionId: posId, module: ctx.module, reason: ctx.reason }));
      return fill;
    };

    for (const [pair, x] of Object.entries(pf.positions)) {
      const nb = nextBar(pair);
      if (x.pendingExit && nb) sell(pair, x.qty, x.pendingExit, nb);
    }

    const eqAtClose = markEquity(pf, bidOf).equity;
    const items = [];
    for (const pair of universe) {
      const i = index[pair].get(t);
      if (i === undefined) continue;
      const bars = candlesByPair[pair];
      const win = bars.slice(Math.max(0, i - p.window_bars + 1), i + 1);
      const held = pf.positions[pair];
      const ctx = held ? { positionValue: held.qty * bars[i].c, equity: eqAtClose } : {};
      const step = computeStep(win, held?.strat ?? null, p, { withHash, ctx });
      items.push({ pair, step, held, i, bars });
    }
    for (const { pair, step, held, i, bars } of orderSteps(items, pf.positions)) {
      const dec = held?.pendingExit ? { raw: 'HOLD', reason: 'menunggu_exit', module: held.strat.module, pos: held.strat } : step.decision;
      let final = dec.raw, block = null;
      const nb = nextBar(pair);
      if (dec.raw === 'BUY') {
        const ext = externalBlocks[`${pair}|${t}`];
        if (ext) block = ext;
        else if (dllHit()) block = 'daily_loss_limit';
        else if (step.invalid.length) block = 'data_tidak_valid:' + step.invalid[0].split(':')[0];
        else if (!nb) block = 'tidak_ada_bar_berikutnya';
        else if (Object.keys(pf.positions).length >= p.max_open_positions) block = 'batas_posisi';
        else {
          const { equity: eq } = markEquity(pf, bidOf);
          const budget = entryBudget({ equity: eq, cash: pf.cash, adtv: dec.adtv }, p);
          const minIdr = minOrderIdr(meta[pair], p);
          const fill = budget >= minIdr ? fillModel('BUY', nb.o, costs[pair], { budgetIdr: budget }, fee.buyPct / 100, meta[pair]) : null;
          if (!fill || fill.notional < minIdr || fill.qty < (meta[pair]?.minQty || 0)) block = 'di_bawah_minimum_order';
          else {
            const posId = applyBuy(pf, pair, fill, dec.pos);
            orders.push(orderRecord({ mode, ts: (t + dur) * 1000, pair, fill, signalPrice: dec.pos.refPrice, signalCandle: dec.pos.entryCandle, positionId: posId, module: dec.module, reason: dec.reason }));
            final = 'BUY_FILLED';
          }
        }
        if (block) { final = 'BLOCKED'; const k = block.split(':').slice(0, 2).join(':'); blockCounts[k] = (blockCounts[k] || 0) + 1; }
      } else if (dec.raw === 'SELL') {
        const ctx = { signalPrice: bars[i].c, candle: t, module: dec.module, reason: dec.reason };
        const fill = nb ? sell(pair, pf.positions[pair].qty, ctx, nb) : null;
        if (fill && !pf.positions[pair]) final = 'SELL_FILLED';
        else { pf.positions[pair].pendingExit = ctx; pf.positions[pair].strat = dec.pos; final = 'SELL_PENDING'; block = 'tidak_ada_bar_berikutnya'; }
      } else if (dec.raw === 'HOLD' && pf.positions[pair] && !held?.pendingExit) {
        pf.positions[pair].strat = dec.pos;
      }
      if (collectSignals || dec.raw === 'BUY' || dec.raw === 'SELL') {
        signals.push({ mode, pair, candle_time: t, raw_action: dec.raw, raw_reason: dec.reason, module: dec.module, final_action: final, block_reason: block, invalid_reasons: step.invalid, ind: collectSignals ? step.ev : undefined, ohlcv: collectSignals ? bars[i] : undefined, window_hash: step.hash });
      }
    }
    const m = markEquity(pf, bidOf);
    equity.push({ mode, ts: new Date(closeMs).toISOString(), cash: m.cash, position_value: m.positionValue, equity: m.equity });
  }
  return { orders, equity, equityDaily, signals, blockCounts, events, openPositions: Object.keys(pf.positions) };
}
