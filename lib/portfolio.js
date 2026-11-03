// Akuntansi portofolio virtual, dipakai bersama oleh bot dan backtest.
export function newPortfolio(capital) { return { cash: capital, positions: {}, nextPositionId: 1 }; }

export function markEquity(pf, bidOf) {
  let val = 0;
  for (const [pair, x] of Object.entries(pf.positions)) {
    const bid = bidOf(pair);
    if (bid > 0) x.lastBid = bid;
    val += x.qty * (x.lastBid || 0);
  }
  return { cash: pf.cash, positionValue: val, equity: pf.cash + val };
}
export function applyBuy(pf, pair, fill, stratPos) {
  pf.cash -= fill.notional + fill.fee;
  const id = pf.nextPositionId++;
  pf.positions[pair] = { id, qty: fill.qty, strat: stratPos, pendingExit: null, lastBid: fill.bestBid };
  return id;
}
export function applySell(pf, pair, fill, minQtyLeft = 1e-12) {
  const x = pf.positions[pair];
  pf.cash += fill.notional - fill.fee;
  x.qty = Number((x.qty - fill.qty).toFixed(12));
  const id = x.id;
  if (x.qty <= minQtyLeft) delete pf.positions[pair];
  return id;
}
export function orderRecord({ mode, ts, pair, fill, signalPrice, signalCandle, positionId, module, reason, callId = null, feeInfo = null, signalTs = null }) {
  const ref = signalPrice;
  return {
    mode, call_id: callId, ts: new Date(ts).toISOString(), pair, side: fill.side, qty: fill.qty,
    best_bid: fill.bestBid, best_ask: fill.bestAsk, avg_fill: fill.avgFill, notional_idr: fill.notional,
    fee_idr: fill.fee, fee_rate: fill.feeRate, spread_cost_idr: fill.spreadCost, slippage_cost_idr: fill.slippageCost,
    signal_price: ref, signal_candle: signalCandle,
    diff_vs_signal_pct: (fill.avgFill - ref) / ref * 100,
    position_id: positionId, module, reason, levels_used: fill.levelsUsed, partial: fill.partial, on_tick: fill.onTick,
    fee_api_pct: feeInfo?.apiPct ?? null, fee_official_buy_pct: feeInfo?.officialBuyPct ?? null, fee_official_sell_pct: feeInfo?.officialSellPct ?? null,
  };
}
