// Eksekusi simulasi. Beli di ask, jual di bid, menghabiskan level berurutan. Tidak pernah memakai mid/close.
export function parseBook(raw) {
  const lv = a => (Array.isArray(a) ? a : [])
    .map(x => [Number(x[0]), Number(x[1])]).filter(([p, q]) => p > 0 && q > 0);
  const bids = lv(raw?.buy).sort((a, b) => b[0] - a[0]);
  const asks = lv(raw?.sell).sort((a, b) => a[0] - b[0]);
  return { bids, asks };
}
export function bookIssue(book, maxSpreadPct) {
  if (!book.bids.length || !book.asks.length) return 'order_book_kosong';
  const b = book.bids[0][0], a = book.asks[0][0];
  if (b >= a) return 'order_book_tersilang';
  const s = (a - b) / ((a + b) / 2) * 100;
  if (s > maxSpreadPct) return `spread_lebar:${s.toFixed(3)}%`;
  return null;
}
export function spreadPct(book) {
  if (!book.bids.length || !book.asks.length) return null;
  const b = book.bids[0][0], a = book.asks[0][0];
  return (a - b) / ((a + b) / 2) * 100;
}
function decimalsOf(inc) { const s = String(inc); return s.includes('.') ? s.split('.')[1].length : 0; }
export function floorQty(q, inc) {
  if (!(inc > 0)) inc = 1e-8;
  const d = Math.max(decimalsOf(inc), inc < 1 ? Math.ceil(-Math.log10(inc)) : 0);
  return Number((Math.floor(q / inc + 1e-9) * inc).toFixed(d));
}
function walkQty(levels, qty) {
  let left = qty, notional = 0, used = 0;
  for (const [p, q] of levels) {
    if (left <= 1e-12) break;
    const take = Math.min(left, q);
    notional += take * p; left -= take; used++;
  }
  return { filled: qty - Math.max(left, 0), notional, levelsUsed: used };
}
function qtyForBudget(levels, budget) {
  let left = budget, qty = 0;
  for (const [p, q] of levels) {
    if (left <= 0) break;
    const cost = p * q;
    if (cost <= left) { qty += q; left -= cost; } else { qty += left / p; left = 0; }
  }
  return qty;
}
export function isOnTick(price, inc) {
  if (!(inc > 0)) return true;
  const r = price / inc;
  return Math.abs(r - Math.round(r)) < 1e-6;
}
function finish(side, book, qty, w, feeRate, meta) {
  const bb = book.bids[0][0], ba = book.asks[0][0], mid = (bb + ba) / 2;
  const best = side === 'BUY' ? ba : bb;
  // Harga rata-rata tidak boleh lebih baik dari level terbaik karena galat pembulatan.
  const avg = side === 'BUY' ? Math.max(w.notional / w.filled, best) : Math.min(w.notional / w.filled, best);
  const levels = side === 'BUY' ? book.asks : book.bids;
  const worst = levels[Math.max(w.levelsUsed - 1, 0)][0];
  return {
    side, qty: w.filled, requestedQty: qty, partial: w.filled < qty - 1e-12,
    bestBid: bb, bestAsk: ba, avgFill: avg, notional: w.notional,
    fee: w.notional * feeRate, feeRate,
    spreadCost: w.filled * Math.abs(best - mid),
    slippageCost: w.filled * Math.abs(avg - best),
    levelsUsed: w.levelsUsed, onTick: isOnTick(worst, meta?.priceInc),
  };
}
// Beli dengan anggaran total IDR (termasuk fee).
export function fillBuy(book, budgetIdr, feeRate, meta = {}) {
  const raw = qtyForBudget(book.asks, budgetIdr / (1 + feeRate));
  const qty = floorQty(raw, meta.qtyInc);
  if (!(qty > 0)) return null;
  return finish('BUY', book, qty, walkQty(book.asks, qty), feeRate, meta);
}
export function fillSell(book, qtyWanted, feeRate, meta = {}) {
  const qty = floorQty(qtyWanted, meta.qtyInc);
  if (!(qty > 0)) return null;
  return finish('SELL', book, qty, walkQty(book.bids, qty), feeRate, meta);
}
// Model biaya backtest. Candle tidak berisi bid/ask, jadi harga dasar = Open bar berikutnya,
// ditambah setengah spread dan slippage hasil pengukuran snapshot.
export function fillModel(side, open, cost, { budgetIdr, qtyWanted }, feeRate, meta = {}) {
  const hs = cost.spreadPct / 200, sl = cost.slippagePct / 100;
  const bb = open * (1 - hs), ba = open * (1 + hs);
  const best = side === 'BUY' ? ba : bb;
  const avg = side === 'BUY' ? ba * (1 + sl) : bb * (1 - sl);
  const raw = side === 'BUY' ? budgetIdr / (1 + feeRate) / avg : qtyWanted;
  const qty = floorQty(raw, meta.qtyInc);
  if (!(qty > 0)) return null;
  const notional = qty * avg;
  return {
    side, qty, requestedQty: qty, partial: false, bestBid: bb, bestAsk: ba, avgFill: avg, notional,
    fee: notional * feeRate, feeRate, spreadCost: qty * open * hs, slippageCost: qty * Math.abs(avg - best),
    levelsUsed: 0, onTick: true,
  };
}
